import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(request: Request, secret: string): boolean {
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
