# Microsoft Entra ID FlowRunner Extension

Manage your Microsoft Entra ID (formerly Azure Active Directory) tenant from FlowRunner over the [Microsoft Graph API](https://learn.microsoft.com/en-us/graph/api/overview). Create and manage users and groups, control group membership and ownership, inspect directory roles, invite external guests, and list application registrations and service principals. Authentication uses OAuth 2.0 with delegated permissions.

## Ideal Use Cases

- Automate employee onboarding by creating a user, setting an initial password, and adding them to the right groups.
- Offboard departing employees by revoking sign-in sessions and deleting or updating their accounts.
- Sync group membership and ownership from an HR system or spreadsheet.
- Invite external partners as B2B guest users.
- Audit directory roles, group members, applications, and service principals.

## List of Actions

### Directory
- Get My Profile

### Users
- List Users
- Get User
- Create User
- Update User
- Delete User
- Reset User Password
- Revoke Sign-In Sessions
- List User's Groups

### Groups
- List Groups
- Get Group
- Create Group
- Update Group
- Delete Group
- List Group Members
- Add Group Member
- Remove Group Member
- Add Group Owner

### Directory Roles
- List Directory Roles
- List Directory Role Members

### Invitations
- Invite Guest User

### Applications
- List Applications
- List Service Principals

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses OAuth 2.0 (Microsoft identity platform / Azure AD v2 endpoint) with delegated permissions. Operations run in the context of the signed-in user, who must hold a directory role (for example User Administrator or Global Administrator) with sufficient privileges for the actions being performed.

1. **Register an app** in the [Microsoft Entra admin center](https://entra.microsoft.com) under **Identity → Applications → App registrations → New registration**, setting the FlowRunner OAuth callback URL as a **Web** redirect URI.
2. **Create a client secret** under **Certificates & secrets** and copy its **Value** immediately (shown only once).
3. **Grant delegated Microsoft Graph permissions** (`openid`, `offline_access`, `User.ReadWrite.All`, `Group.ReadWrite.All`, `Directory.ReadWrite.All`) and select **Grant admin consent** — these are admin-restricted scopes requiring tenant admin consent.
4. **Configure the service** with your **Client ID** (Application ID) and **Client Secret**, then connect an account through the FlowRunner OAuth flow.

## Notes

- Microsoft Graph returns large collections in pages. When a response includes an `@odata.nextLink`, pass it to the **Next Page Link** parameter of the same operation to retrieve the next page.
- Full-text search parameters automatically send the `ConsistencyLevel: eventual` header required by Microsoft Graph advanced queries.
- **Add Group Member**, **Remove Group Member**, and **Add Group Owner** require a user **object ID** (a user principal name is not accepted for the reference APIs).

## Agent Ideas

- When onboarding a new hire, use **Microsoft Entra ID** "Create User" and "Add Group Member", then use **Microsoft Teams** "Send Channel Message" to announce them in the team channel.
- After **Microsoft Entra ID** "Invite Guest User" completes, use **Outlook** "Send Message" to email the guest a personalized welcome with next steps.
- Use **Microsoft Entra ID** "List Group Members" to enumerate a team, then create a **Microsoft To Do** "Create Task" for each member as part of a compliance or training checklist.
