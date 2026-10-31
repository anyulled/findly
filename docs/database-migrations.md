# Supabase database migrations

## Pull request validation

The required `Database migrations` check starts a local Postgres instance with the Supabase CLI, applies every checked-in migration to a clean database, runs `supabase db lint --local --fail-on error`, and executes every transactional SQL script in `supabase/tests/`. It has no credentials for or connection to a hosted Supabase project. Invalid SQL, ordering conflicts, duplicate migration versions, or schema/function errors fail the PR check.

Run the same checks locally with Docker and Supabase CLI 2.122.0:

```sh
supabase db start
supabase db reset --local --no-seed
supabase db lint --local --fail-on error
for test_file in supabase/tests/*.sql; do
  psql postgresql://postgres:postgres@127.0.0.1:55432/postgres -X -v ON_ERROR_STOP=1 -f "$test_file"
done
```

## Deployment after merge

After migration files are pushed to `main`, the **Apply Supabase migrations** workflow links the production project, previews pending migrations with `supabase db push --dry-run --linked`, then applies them with `supabase db push --linked`. Deploy runs are serialized so two merges cannot push migrations concurrently. You can also run it manually with `workflow_dispatch`.

Configure these GitHub values to enable deployment:

- Repository variable `SUPABASE_PROJECT_REF`: the project ref from the Supabase dashboard URL.
- Repository secret `SUPABASE_ACCESS_TOKEN`: a Supabase personal access token for the CLI.
- Repository secret `SUPABASE_DB_PASSWORD`: the database password for that project.

Without all three values, the workflow emits a warning and skips the remote link and push. PR checks continue to validate migrations against local Postgres without hosted credentials. Never add these credentials to the repository or expose them in browser variables.

Use migration files as the only way to change the hosted schema. Do not edit production tables or functions in the dashboard, since that bypasses migration history and causes future pushes to fail with a sync error.
