# Vero FlowRunner Extension

Customer engagement and behavioral email automation with Vero via the Vero Track REST API (v2). Vero follows an identify-then-track model: first identify a user (create/update their profile) with a stable unique id, then track events they perform to power behavioral email campaigns. This extension manages user profiles, tags, and email subscription state, and tracks events.

## Ideal Use Cases

- Sync users into Vero as they sign up, then track their in-app activity to trigger behavioral email campaigns
- Keep profile properties (plan, signup date, name) current so campaigns can segment and personalize
- Tag and segment customers, and manage email subscription state for compliance and preferences
- Migrate anonymous/temporary user ids to permanent ids after signup while preserving history

## List of Actions

### Users

- Identify User
- Update User
- Reidentify User
- Edit User Tags
- Unsubscribe User
- Resubscribe User
- Delete User

### Events

- Track Event

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses your Vero project Auth Token (API v2), found in Vero under Project → Settings → Auth Token. Vero passes the token in the JSON request body of every call (as `auth_token`), not in an HTTP header; the service adds it automatically, so you configure it once. Base URL: `https://api.getvero.com/api/v2`.

## Notes

- A user should be identified (via Identify User) before events are tracked against them. Tracking an event with an identity Vero has not seen will create the user from that identity.
- Vero returns a `{ status, message }` body (or a 4xx HTTP status) on failure; the service surfaces the Vero `message` and status code to make errors easy to diagnose.

## Agent Ideas

- After a **Stripe** "Create Subscription" succeeds, call **Vero** "Track Event" with the plan details to enroll the customer in an onboarding email campaign, and "Update User" to store their plan on the profile.
- When **Segment** "Identify User" captures a new signup, mirror it into **Vero** "Identify User" and "Edit User Tags" so behavioral campaigns can target the right segment.
- When **Vero** "Track Event" records a churn-risk signal, use **Slack** "Send Message To Channel" to alert the customer success team with the user id and event details.
