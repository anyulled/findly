# Meetup event source

## Research status

Reviewed Meetup's official GraphQL documentation and API license terms on 2026-10-31. No real event URL, Meetup account, OAuth client, or API token was available for testing.

A public group RSS URL was verified for Software Crafters Barcelona: [Meetup events RSS](https://www.meetup.com/software-crafters-barcelona/events/rss/). On 2026-10-31 it returned HTTP 200 with `application/rss+xml`, but contained no `<item>` entries. This confirms that the group endpoint exists, not that it currently supplies upcoming events or that all Meetup groups have feeds.

## Documented API option

Meetup documents an authenticated GraphQL API at `https://api.meetup.com/gql-ext`. Its event query can return fields including `title`, `eventUrl`, `description`, and `dateTime`; the guide also shows searching upcoming events for a Pro Network with cursor pagination. API requests use a Bearer access token. See the [GraphQL API guide](https://www.meetup.com/graphql/guide/) and [API introduction](https://www.meetup.com/graphql/).

Meetup's API license terms say API access requires a Meetup Pro subscription, registering an API application, and Meetup's authorization. The documented OAuth server flow requires a registered redirect URI and exchanges an authorization code for access and refresh tokens. Access tokens expire; refresh tokens are single-use, so refresh-token rotation and secure server-side storage would be required. See the [API license terms](https://help.meetup.com/hc/en-us/articles/360028705532-Meetup-API-license-terms) and [OAuth authentication guide](https://www.meetup.com/graphql/authentication/).

The API terms also prohibit commercial use without Meetup's express written consent. Confirm subscription eligibility, application approval, and applicable terms before building or operating this integration.

## Current integration decision

- Use the manual event form for single Meetup events. Its URL extractor reads public page metadata and structured event data when available; the owner reviews and corrects the result. This best-effort HTML extraction is not a stable Meetup API contract.
- Do not add recurring Meetup polling or broader scraping. If Meetup Pro and API authorization become available, evaluate the documented GraphQL API as the supported integration. Use only fields needed by Findly.
- The verified Software Crafters Barcelona RSS link may be configured as a source after confirming expected entries. It was empty during the check, so it did not establish event coverage. Do not generalize its URL pattern to other groups.

No Meetup feed polling or OAuth flow is implemented. Manual URL extraction supports public HTTPS Meetup event pages and can leave fields for owner completion.
