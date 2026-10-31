# Meetup event source

## Research status

Reviewed Meetup's official GraphQL documentation and API license terms on 2026-10-31. No real event URL, Meetup account, OAuth client, or API token was available for testing.

The official documentation reviewed does not describe a general RSS or iCalendar feed for event listings. This is a limit of the documentation reviewed, not proof that no account-specific feed exists. Do not assume one until a concrete URL is checked.

## Documented API option

Meetup documents an authenticated GraphQL API at `https://api.meetup.com/gql-ext`. Its event query can return fields including `title`, `eventUrl`, `description`, and `dateTime`; the guide also shows searching upcoming events for a Pro Network with cursor pagination. API requests use a Bearer access token. See the [GraphQL API guide](https://www.meetup.com/graphql/guide/) and [API introduction](https://www.meetup.com/graphql/).

Meetup's API license terms say API access requires a Meetup Pro subscription, registering an API application, and Meetup's authorization. The documented OAuth server flow requires a registered redirect URI and exchanges an authorization code for access and refresh tokens. Access tokens expire; refresh tokens are single-use, so refresh-token rotation and secure server-side storage would be required. See the [API license terms](https://help.meetup.com/hc/en-us/articles/360028705532-Meetup-API-license-terms) and [OAuth authentication guide](https://www.meetup.com/graphql/authentication/).

The API terms also prohibit commercial use without Meetup's express written consent. Confirm subscription eligibility, application approval, and applicable terms before building or operating this integration.

## Current integration decision

- Use the manual event form for Meetup events. Keep the Meetup URL as a reference and let the owner enter or correct the event details.
- If Meetup Pro and API authorization are available, prefer the documented GraphQL API over page scraping. Use the event ID from a supplied event link where possible, and fetch only the fields needed by Findly.
- Do not implement scraping until a concrete event URL and an allowed, reliable access path have been reviewed. Public page markup is not a documented integration contract.
- If a verified RSS or iCalendar URL is later provided, test its format and field coverage before enabling polling. This research did not verify such a feed.

No Meetup feed polling, OAuth flow, or page extraction is currently implemented.
