const BUFFER_API_URL = "https://api.buffer.com";
const CREATE_SCHEDULED_POST = `
  mutation CreateScheduledPost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        __typename
        post {
          id
          text
          dueAt
        }
      }
      ... on MutationError {
        __typename
        message
      }
    }
  }
`;

export type BufferFailureOutcome = "rejected" | "unknown";

export interface BufferGraphQLError {
  message: string;
  code?: string;
}

export class BufferConfigurationError extends Error {
  readonly kind = "configuration" as const;

  constructor(message: string) {
    super(message);
    this.name = "BufferConfigurationError";
  }
}

export class BufferInputError extends Error {
  readonly kind = "input" as const;

  constructor(message: string) {
    super(message);
    this.name = "BufferInputError";
  }
}

export class BufferApiError extends Error {
  readonly kind = "api" as const;
  readonly code?: string;
  readonly httpStatus?: number;
  readonly outcome: BufferFailureOutcome;
  readonly errors: BufferGraphQLError[];

  constructor(options: {
    message: string;
    code?: string;
    httpStatus?: number;
    outcome: BufferFailureOutcome;
    errors?: BufferGraphQLError[];
  }) {
    super(options.message);
    this.name = "BufferApiError";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.outcome = options.outcome;
    this.errors = options.errors ?? [];
  }
}

export class BufferUncertainResultError extends Error {
  readonly kind = "uncertain" as const;
  readonly retryDisposition = "reconcile_before_retry" as const;
  readonly httpStatus?: number;

  constructor(message: string, options: { cause?: unknown; httpStatus?: number } = {}) {
    super(message, { cause: options.cause });
    this.name = "BufferUncertainResultError";
    this.httpStatus = options.httpStatus;
  }
}

export interface ScheduleBufferPostInput {
  /** A single connected Buffer channel. One GraphQL mutation is sent per channel. */
  channelId: string;
  text: string;
  /** An ISO 8601 instant in UTC, ending in `Z`. */
  dueAt: string;
}

export interface BufferScheduledPost {
  id: string;
  text: string;
  dueAt: string | null;
}

export type ScheduleBufferPostResult =
  | { kind: "scheduled"; post: BufferScheduledPost; warnings: BufferGraphQLError[] }
  | { kind: "rejected"; error: { type: string; message: string } };

export interface BufferClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface RawGraphQLError {
  message?: unknown;
  extensions?: { code?: unknown };
}

interface GraphQLEnvelope {
  data?: { createPost?: unknown } | null;
  errors?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseGraphQLErrors(value: unknown): BufferGraphQLError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: RawGraphQLError) => {
    const message = typeof entry?.message === "string" ? entry.message : null;
    if (!message) return [];
    const code = typeof entry.extensions?.code === "string" ? entry.extensions.code : undefined;
    return [{ message, code }];
  });
}

function isUtcInstant(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && hour <= 23 && minute <= 59 && second <= 59;
}

function validateInput(input: ScheduleBufferPostInput): void {
  if (!input.channelId.trim()) throw new BufferInputError("A Buffer channel ID is required.");
  if (!input.text.trim()) throw new BufferInputError("Post text cannot be empty.");
  if (!isUtcInstant(input.dueAt)) {
    throw new BufferInputError("dueAt must be a valid ISO 8601 UTC timestamp ending in Z.");
  }
}

export class BufferClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: BufferClientOptions) {
    this.apiKey = options.apiKey.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    if (!this.apiKey) throw new BufferConfigurationError("A Buffer API key is required.");
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new BufferConfigurationError("The Buffer request timeout must be a positive number.");
    }
  }

  private async postMutation(input: ScheduleBufferPostInput): Promise<Response> {
    try {
      return await this.fetchImpl(BUFFER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query: CREATE_SCHEDULED_POST,
          variables: {
            input: {
              channelId: input.channelId,
              text: input.text,
              schedulingType: "automatic",
              mode: "customScheduled",
              dueAt: input.dueAt,
            },
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new BufferUncertainResultError(
        "Buffer returned no response. Reconcile the channel queue before retrying this post.",
        { cause },
      );
    }
  }

  private async parseResponseEnvelope(response: Response): Promise<GraphQLEnvelope> {
    if (response.status >= 500) {
      throw new BufferUncertainResultError(
        "Buffer returned a server error. Reconcile the channel queue before retrying this post.",
        { httpStatus: response.status },
      );
    }

    let rawEnvelope: unknown;
    try {
      rawEnvelope = await response.json();
    } catch (cause) {
      if (response.status >= 500) {
        throw new BufferUncertainResultError(
          "Buffer returned a server error without a readable result. Reconcile the channel queue before retrying.",
          { cause, httpStatus: response.status },
        );
      }
      if (!response.ok) {
        throw new BufferApiError({
          message: `Buffer rejected the request with HTTP ${response.status}.`,
          httpStatus: response.status,
          outcome: "rejected",
        });
      }
      throw new BufferUncertainResultError(
        "Buffer returned an unreadable response. Reconcile the channel queue before retrying.",
        { cause, httpStatus: response.status },
      );
    }

    const envelope = asRecord(rawEnvelope) as GraphQLEnvelope | null;
    if (!envelope) {
      if (!response.ok && response.status < 500) {
        throw new BufferApiError({
          message: `Buffer rejected the request with HTTP ${response.status}.`,
          httpStatus: response.status,
          outcome: "rejected",
        });
      }
      throw new BufferUncertainResultError(
        "Buffer returned a response without a GraphQL result. Reconcile the channel queue before retrying.",
        { httpStatus: response.status },
      );
    }
    return envelope;
  }

  private handleBufferErrors(response: Response, errors: BufferGraphQLError[]): never {
    if (!response.ok) {
      throw new BufferApiError({
        message: errors[0]?.message ?? `Buffer rejected the request with HTTP ${response.status}.`,
        code: errors[0]?.code,
        httpStatus: response.status,
        outcome: "rejected",
        errors,
      });
    }

    if (errors.length > 0) {
      const outcome = errors.some((error) => error.code === "UNEXPECTED") ? "unknown" : "rejected";
      throw new BufferApiError({
        message: errors[0].message,
        code: errors[0].code,
        httpStatus: response.status,
        outcome,
        errors,
      });
    }

    throw new BufferUncertainResultError(
      "Buffer returned no recognizable createPost result. Reconcile the channel queue before retrying.",
      { httpStatus: response.status },
    );
  }

  private processCreatePostPayload(
    response: Response,
    payload: Record<string, unknown> | null,
    errors: BufferGraphQLError[],
  ): ScheduleBufferPostResult {
    if (payload && payload.__typename === "PostActionSuccess") {
      if (!response.ok) {
        throw new BufferApiError({
          message: `Buffer rejected the request with HTTP ${response.status}.`,
          httpStatus: response.status,
          outcome: "rejected",
          errors,
        });
      }
      const post = asRecord(payload.post);
      if (!post || typeof post.id !== "string" || typeof post.text !== "string") {
        throw new BufferUncertainResultError(
          "Buffer accepted the mutation but returned incomplete post data. Reconcile before retrying.",
          { httpStatus: response.status },
        );
      }
      return {
        kind: "scheduled",
        post: {
          id: post.id,
          text: post.text,
          dueAt: typeof post.dueAt === "string" ? post.dueAt : null,
        },
        warnings: errors,
      };
    }

    if (payload && typeof payload.message === "string") {
      return {
        kind: "rejected",
        error: {
          type: typeof payload.__typename === "string" ? payload.__typename : "MutationError",
          message: payload.message,
        },
      };
    }

    this.handleBufferErrors(response, errors);
  }

  async schedulePost(input: ScheduleBufferPostInput): Promise<ScheduleBufferPostResult> {
    validateInput(input);
    const response = await this.postMutation(input);
    const envelope = await this.parseResponseEnvelope(response);
    const errors = parseGraphQLErrors(envelope.errors);
    const payload = asRecord(asRecord(envelope.data)?.createPost);
    return this.processCreatePostPayload(response, payload, errors);
  }
}
