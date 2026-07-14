# Google Workspace Admin FlowRunner Extension

Manage a Google Workspace account through the [Admin SDK Directory API](https://developers.google.com/admin-sdk/directory/reference/rest/v1): create and manage users, groups, group members, organizational units, domains, admin roles, and mobile devices. Authenticates via OAuth 2.0 with a Google Workspace administrator account.

## Ideal Use Cases

- Automate employee onboarding by creating a user, placing them in an organizational unit, and adding them to the right groups.
- Automate offboarding by suspending, deleting, or reassigning a departing employee's account and group memberships.
- Keep group membership in sync with an external system of record (HR, directory, or spreadsheet).
- Audit administrator role assignments, domains, and synchronized mobile devices for compliance reporting.
- Grant or revoke super administrator privileges and manage user aliases programmatically.

## List of Actions

- **Users** — List Users, Get User, Create User, Update User, Delete User, Suspend User, Unsuspend User, Undelete User, Make User Admin, List User Aliases, Add User Alias
- **Groups** — List Groups, Get Group, Create Group, Update Group, Delete Group
- **Group Members** — List Group Members, Get Group Member, Add Group Member, Update Group Member, Remove Group Member, Check Has Member
- **Org Units** — List Org Units, Get Org Unit, Create Org Unit, Update Org Unit, Delete Org Unit
- **Domains & Roles** — List Domains, List Roles, List Role Assignments
- **Devices** — List Mobile Devices

## List of Triggers

This service does not define any triggers.

## Authentication

This service uses OAuth 2.0 with Google. You must connect with a **Google Workspace administrator account** that has consented to the Admin SDK scopes.

### Setup

1. In the [Google Cloud Console](https://console.cloud.google.com/), create (or reuse) a project and enable the **Admin SDK API**.
2. Configure the **OAuth consent screen** and create an **OAuth 2.0 Client ID** (Web application). Add the FlowRunner OAuth redirect URI.
3. Enter the **Client ID** and **Client Secret** as the service configuration items.
4. Connect the integration and complete the Google consent flow while signed in as a Workspace administrator.

The following scopes are requested:

```
openid email profile
https://www.googleapis.com/auth/admin.directory.user
https://www.googleapis.com/auth/admin.directory.group
https://www.googleapis.com/auth/admin.directory.group.member
https://www.googleapis.com/auth/admin.directory.orgunit
https://www.googleapis.com/auth/admin.directory.domain.readonly
https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly
https://www.googleapis.com/auth/admin.directory.device.mobile.readonly
```

## Notes

### The `my_customer` alias

Every operation that targets your account uses the special alias **`my_customer`** in place of a numeric customer id. It always resolves to the account of the authenticated administrator, so there is nothing to configure — connect as an admin and all customer-scoped operations (users, groups, org units, domains, roles, devices) automatically apply to your own Google Workspace account.

### Key concepts

- **userKey** — a user is addressed by their **primary email** or their unique **id**. Undelete User is the exception: a deleted user has no email, so it requires the unique **id** (find it via List Users with *Show Deleted* enabled).
- **groupKey** — a group is addressed by its **email** or unique **id**.
- **Group member roles** — `MEMBER`, `MANAGER`, or `OWNER`. The service presents these as friendly dropdown labels (Member / Manager / Owner).
- **orgUnitPath** — organizational units are identified by their path (e.g. `/Sales/Marketing`). For **Get / Update / Delete Org Unit** the path is passed in the URL **without a leading slash** (e.g. `Sales/Marketing`); the service strips a leading slash automatically if you include one. When creating a unit, `Parent Org Unit Path` does use the leading-slash form (e.g. `/Sales`, or `/` for the root).

### Pagination

List operations return a `nextPageToken`. Pass it back via the **Page Token** parameter to retrieve the next page.

### Other notes

- Requires a Google Workspace administrator account with admin consent granted to the OAuth app.
- The read-only scopes (domains, roles, mobile devices) mean the corresponding operations are list/read only.
- Two dictionaries power dynamic parameter pickers: a searchable list of users (label: full name, value: primary email) and a searchable list of groups (label: name, value: email).

## Agent Ideas

- After **Create User** provisions a new employee, use **Gmail** "Send Message" to send their manager the temporary password and first-sign-in instructions.
- When onboarding, **Add Group Member** to add the new user to a team mailing list, then use **Google Chat** "Add Member" to place them in the team's chat space.
- Use **List Users** (with *Show Deleted* enabled) and **List Role Assignments** to build an access-audit report, then write each record with **Google Sheets** "Add Row".
