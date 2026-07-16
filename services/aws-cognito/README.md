# AWS Cognito FlowRunner Extension

Zero-dependency integration with Amazon Cognito User Pools using native AWS Signature V4 signing (Node crypto). Administer users, groups, user pools, and app clients from your flows. This service uses the Cognito **Identity Provider** (User Pools) admin API, so all operations authenticate with IAM credentials — direct API Key or an assumed IAM Role — rather than with an end-user session.

## Ideal Use Cases

- Provisioning and de-provisioning users in a user pool (create, confirm, enable/disable, delete)
- Managing passwords administratively (set a permanent or temporary password, trigger a reset)
- Reading and updating user attributes as part of an automated onboarding or sync flow
- Searching and paginating through a user pool's members with attribute filters
- Managing groups and group membership for role-based access
- Discovering user pools and app clients and inspecting their configuration

## List of Actions

### User Management

- Admin Create User
- Admin Get User
- List Users
- Admin Update User Attributes
- Admin Delete User
- Admin Enable User
- Admin Disable User
- Admin Reset User Password
- Admin Set User Password
- Admin Confirm Sign Up

### Group Management

- Create Group
- List Groups
- Get Group
- Delete Group
- Admin Add User To Group
- Admin Remove User From Group
- Admin List Groups For User

### User Pools

- List User Pools
- Describe User Pool
- Create User Pool

### App Clients

- List User Pool Clients
- Describe User Pool Client

## Configuration

- **Authentication Method** — `API Key` (access key directly) or `IAM Role` (STS AssumeRole with a Role ARN for cross-account access).
- **Region** — AWS region code, e.g. `us-east-1`. This must match the region of your user pools.
- **Access Key** / **Secret Key** — AWS credentials, required for both methods.
- **IAM Role ARN** — role to assume, required for IAM Role authentication.
- **External ID** — optional external ID for cross-account role assumption.

The IAM principal must be granted the relevant `cognito-idp:*` permissions (e.g. `cognito-idp:AdminCreateUser`, `cognito-idp:ListUsers`, `cognito-idp:CreateGroup`).

## Notes

- **User Pool ID** — nearly every operation takes a **User Pool ID** (e.g. `us-east-1_abc123`). A searchable **Get User Pools** dictionary populates this field automatically; the group operations use a dependent **Get Groups** dictionary keyed off the selected user pool.
- **Admin operations use IAM credentials** — the admin (`Admin*`) API acts on behalf of your account, not an end user, so no user access token is involved.
- **Attributes as plain JSON** — user attributes are supplied and returned as a plain JSON object keyed by attribute name (e.g. `{"email":"a@b.com","email_verified":"true","name":"Ada"}`). The service converts to and from Cognito's `[{Name, Value}]` attribute-value format automatically. Custom attributes use the `custom:` prefix.
- **Message Action** — Admin Create User accepts `Suppress` (create without an invitation) or `Resend` (resend an invitation); leave it empty to send a new invitation.
- **Permanent vs. temporary passwords** — Admin Set User Password with `Permanent` true confirms the user immediately; false requires the user to change the password on next sign-in.
- **Pagination** — list operations return a `paginationToken` / `nextToken`; pass it back on the next call to fetch the following page.

## Agent Ideas

- When a new customer signs up, use **Stripe** "Create Customer" to set up billing and **AWS Cognito** "Admin Create User" to provision the account, then use **Gmail** "Send Message" to send a personalized welcome.
- Use **AWS Cognito** "List Users" with a filter to find inactive or unconfirmed accounts, then use **AWS Cognito** "Admin Disable User" and **Slack** "Send Message To Channel" to report the cleanup.
- On an offboarding trigger, use **AWS Cognito** "Admin List Groups For User" to record a user's roles, then "Admin Remove User From Group" and "Admin Delete User" to fully de-provision them.
