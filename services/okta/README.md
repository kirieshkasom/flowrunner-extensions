# Okta FlowRunner Extension

Automate identity and access management in your Okta org from FlowRunner. Manage users, organize them into groups, automate membership with group rules, assign applications and admin roles, manage MFA factors and authenticators, read the System Log, and configure org security: sign-on and password policies with their rules, network zones, trusted origins, outbound event / inline hooks, external identity providers, profile schemas and mappings, and custom OAuth authorization servers with their token scopes, claims, access policies and rules, and signing keys. Manage application credentials end to end - SSO signing keys and CSRs, OAuth client JSON Web Keys and secrets, app logos, and resource-server keys - and identity-provider keys, signing keys, CSRs, and stored social tokens. Read and update individual application user and group assignments. Audit and revoke users' OAuth grants, tokens, and sign-in sessions. Authenticates with an Okta API token (SSWS) over your org base URL.

## Ideal Use Cases

- Onboard and offboard employees: create, activate, suspend, deactivate, or delete users.
- Keep group membership current - add/remove users, or let group rules auto-assign by attribute.
- Grant or revoke application access for a user or a whole group.
- Delegate administration by assigning and removing standard admin roles.
- Reset passwords and MFA factors for help-desk and security workflows, including recovery-question and verify/resend flows.
- Define custom user-to-user relationships (e.g. manager/subordinate, mentor/mentee) with linked objects, and assign group owners.
- Pull System Log events for auditing, alerting, or reporting, or react in real time via the polling trigger.
- Define IP/dynamic network zones and CORS/redirect trusted origins for sign-on policy and app security.
- Register outbound event hooks to push Okta events to your services, and inline hooks to customize token, registration, and password-import flows.
- Connect external identity providers (OIDC, SAML 2.0, social) and link or unlink users to them.
- Extend user, group, and app profile schemas with custom attributes, and tune profile mappings to downstream apps.
- Add and configure MFA authenticators (Duo, Temporary Access Code, WebAuthn allowlists) and their methods.
- Audit and revoke a user's OAuth grants and refresh tokens, and clear a user's sign-in sessions in response to a security event.
- Rotate application and identity-provider credentials: generate or clone SSO signing keys, manage CSRs, register OAuth client keys/secrets, and rotate authorization-server signing keys.
- Govern API access on custom authorization servers by managing access policies, their rules, and resource-server keys.

## List of Actions

**Users**: Create User, Get User, List Users, Update User, Delete User, Get User Groups, List Assigned App Links, List User Blocks, List User Devices

**User Lifecycle**: Activate User, Deactivate User, Suspend User, Unsuspend User, Unlock User, Reactivate User, Expire Password, Reset Password, Reset Factors, Change Password, Set Password, Forgot Password, Reset Password via Recovery Question, Change Recovery Question

**Groups**: Create Group, Get Group, List Groups, Update Group, Delete Group, Add User to Group, Remove User from Group, List Group Members, List Assigned Apps for Group, List Group Owners, Assign Group Owner, Remove Group Owner

**Group Rules**: Create Group Rule, Get Group Rule, List Group Rules, Replace Group Rule, Activate Group Rule, Deactivate Group Rule, Delete Group Rule

**Applications**: List Applications, Get Application, Create Application, Replace Application, Delete Application, Activate Application, Deactivate Application, Assign User to Application, Unassign User from Application, Get Application User, Update Application User, Assign Group to Application, Remove Group from Application, Get Application Group Assignment, Update Application Group Assignment, List Application Users, List Application Group Assignments

**Application Credentials**: List Application Keys, Generate Application Key, Get Application Key, Clone Application Key, List Application CSRs, Generate Application CSR, Get Application CSR, Revoke Application CSR, Publish Application CSR, List Application Client Keys, Add Application Client Key, Get Application Client Key, Delete Application Client Key, Activate Application Client Key, Deactivate Application Client Key, List Application Client Secrets, Create Application Client Secret, Get Application Client Secret, Delete Application Client Secret, Activate Application Client Secret, Deactivate Application Client Secret, Upload Application Logo, List Resource Server Keys, Add Resource Server Key, Get Resource Server Key, Delete Resource Server Key, Activate Resource Server Key, Deactivate Resource Server Key

**Admin Roles**: Assign Role to User, List Roles Assigned to User, Remove Role from User

**MFA Factors**: List Factors, Enroll Factor, Activate Factor, Reset Factor, Verify Factor, Resend Enrollment Challenge, List Supported Factors, List Security Questions

**System Log**: Get Logs

**Network Zones**: List Network Zones, Create Network Zone, Get Network Zone, Update Network Zone, Delete Network Zone, Activate Network Zone, Deactivate Network Zone

**Trusted Origins**: List Trusted Origins, Create Trusted Origin, Get Trusted Origin, Update Trusted Origin, Delete Trusted Origin, Activate Trusted Origin, Deactivate Trusted Origin

**Event Hooks**: List Event Hooks, Create Event Hook, Get Event Hook, Update Event Hook, Delete Event Hook, Activate Event Hook, Deactivate Event Hook, Verify Event Hook

**Inline Hooks**: List Inline Hooks, Create Inline Hook, Get Inline Hook, Update Inline Hook, Delete Inline Hook, Activate Inline Hook, Deactivate Inline Hook, Execute Inline Hook

**Policies**: List Policies, Create Policy, Get Policy, Replace Policy, Delete Policy, Activate Policy, Deactivate Policy

**Policy Rules**: List Policy Rules, Create Policy Rule, Get Policy Rule, Replace Policy Rule, Delete Policy Rule, Activate Policy Rule, Deactivate Policy Rule

**Authorization Servers**: List Authorization Servers, Create Authorization Server, Get Authorization Server, Replace Authorization Server, Delete Authorization Server, Activate Authorization Server, Deactivate Authorization Server

**Token Scopes & Claims**: List Token Scopes, Create Token Scope, Get Token Scope, Replace Token Scope, Delete Token Scope, List Token Claims, Create Token Claim, Get Token Claim, Replace Token Claim, Delete Token Claim

**Authorization Server Policies**: List Authorization Server Policies, Create Authorization Server Policy, Get Authorization Server Policy, Replace Authorization Server Policy, Delete Authorization Server Policy, Activate Authorization Server Policy, Deactivate Authorization Server Policy, List Authorization Server Policy Rules, Create Authorization Server Policy Rule, Get Authorization Server Policy Rule, Replace Authorization Server Policy Rule, Delete Authorization Server Policy Rule, Activate Authorization Server Policy Rule, Deactivate Authorization Server Policy Rule

**Authorization Server Keys**: List Authorization Server Keys, Get Authorization Server Key, Rotate Authorization Server Keys, List Authorization Server Clients

**Behaviors**: List Behavior Rules, Create Behavior Rule, Get Behavior Rule, Update Behavior Rule, Delete Behavior Rule, Activate Behavior Rule, Deactivate Behavior Rule

**User Types**: List User Types, Create User Type, Get User Type, Update User Type, Replace User Type, Delete User Type

**ThreatInsight**: Get ThreatInsight Configuration, Update ThreatInsight Configuration

**Devices**: List Devices, Get Device, Delete Device, Activate Device, Deactivate Device, Suspend Device, Unsuspend Device, List Device Users

**Linked Objects**: List Linked Object Definitions, Create Linked Object Definition, Get Linked Object Definition, Delete Linked Object Definition, Link Users, List User Linked Values, Unlink User

**Identity Providers**: List Identity Providers, Create Identity Provider, Get Identity Provider, Replace Identity Provider, Delete Identity Provider, Activate Identity Provider, Deactivate Identity Provider, List IdP Users, Get IdP User, Link User to IdP, Unlink User from IdP

**Identity Provider Keys**: List Org IdP Keys, Create Org IdP Key, Get Org IdP Key, Replace Org IdP Key, Delete Org IdP Key, List IdP Signing Keys, List Active IdP Signing Key, Generate IdP Signing Key, Get IdP Signing Key, Clone IdP Signing Key, List IdP CSRs, Generate IdP CSR, Get IdP CSR, Revoke IdP CSR, Publish IdP CSR, List Social IdP User Tokens

**Schemas & Mappings**: Get User Schema, Update User Schema, Get Group Schema, Update Group Schema, Get App User Schema, Update App User Schema, List Profile Mappings, Get Profile Mapping, Update Profile Mapping

**Authenticators**: List Authenticators, Create Authenticator, Get Authenticator, Replace Authenticator, Activate Authenticator, Deactivate Authenticator, List Authenticator Methods, Get Authenticator Method, Replace Authenticator Method, Activate Authenticator Method, Deactivate Authenticator Method, List Custom AAGUIDs, Create Custom AAGUID, Get Custom AAGUID, Replace Custom AAGUID, Delete Custom AAGUID, Get Well-Known App Authenticator Config

**User OAuth Grants**: List User Grants, Revoke All User Grants, Get User Grant, Revoke User Grant, List User Clients, List Grants For Client, Revoke Grants For Client, List Refresh Tokens For Client, Revoke All Tokens For Client, Get Refresh Token, Revoke Refresh Token

**Sessions**: Get Session, Refresh Session, Revoke Session, Revoke All User Sessions

## List of Triggers

- On New System Log Event

## Agent Ideas

- **Automated onboarding**: create a user, add them to the right groups, assign their applications, and enroll an MFA factor - all in one flow triggered by a new-hire record.
- **Security-incident response**: watch the System Log trigger for a suspicious event, then suspend the user, revoke their OAuth grants and refresh tokens, and clear their active sessions.
- **Access recertification**: list a user's admin roles, application assignments, and OAuth grants on a schedule and report anything unexpected for review.
- **Self-service password/MFA help desk**: reset a password or MFA factors, resend an enrollment challenge, or unlock a locked-out user from a support ticket.
- **Policy-as-code**: create sign-on/password policies with their rules, define network zones and trusted origins, and toggle ThreatInsight to enforce security posture from version-controlled definitions.
- **Credential rotation**: rotate authorization-server signing keys, generate or clone application SSO keys, and manage CSRs and OAuth client secrets on a recurring routine.
- **IdP lifecycle**: connect an external OIDC/SAML identity provider, link users to it, and manage its signing keys and CSRs.
- **Group-driven automation**: define group rules that auto-assign users by profile attribute, then grant those groups application access.
