# ESLint

The flat configuration in `eslint.config.mjs` uses the recommended Next.js `core-web-vitals` rules and the TypeScript rules from the installed `eslint-config-next` package. Next.js documents that these presets already include its Next.js plugin, React rules, and React Hooks rules; adding the same plugins again would duplicate configuration.

The app therefore inherits the framework rules for App Router and React Hooks, including Rules of Hooks, dependency checking, and React Compiler diagnostics, as well as Next.js performance rules. The project also treats unused ESLint disable directives as errors so stale suppressions do not silently accumulate.

Run `npm run lint` to apply the flat configuration to the project. CI runs the same command on pull requests and pushes to `main`.
