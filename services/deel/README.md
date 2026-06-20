# Deel FlowRunner Extension

Integration with Deel's global HR, payroll, and contracting platform. Manage people and HRIS data, contractor and EOR contracts, time off, adjustments, payouts, global payroll, applicant tracking, immigration, screenings, IT assets, and invoices through a single OAuth2-connected service. Connects to either the Production or Sandbox (demo) environment.

## Ideal Use Cases

- Onboarding and offboarding workers across contractor, EOR, and direct-employee models
- Syncing people, departments, and org-structure data between Deel and your HRIS or database
- Automating time-off requests, approvals, and balance checks
- Adding bonuses, deductions, and reimbursements before payroll cycles close
- Running global-payroll and EOR workflows (compensation, payslips, gross-to-net reports)
- Driving recruiting flows through Deel's ATS (jobs, candidates, applications, offers)
- Reacting in real time to Deel events such as signed contracts or available payslips

## List of Actions

### Setup & Organization
- Test Connection
- Get My Profile
- Get Organization
- List Managers

### People & HRIS
- List People
- Get Person
- Update Person
- Update Working Location
- Create Person Without Contract
- Create Direct Employee
- List Worker Relations
- List Org Structure
- Get Org Structure Node
- Create Org Structure Node
- Update Org Structure Node
- Delete Org Structure Node
- Get Custom Fields
- Set Custom Field
- Delete Custom Field Value

### Contracts (IC)
- List Contracts
- Get Contract
- Create Contractor Contract
- Send Contract to Worker
- Sign Contract
- Preview Contract Agreement
- Get Worker Invite Link
- Remove Worker Invite
- Terminate Contract
- Amend Contract
- List Amendments
- List Milestones
- Create Milestone
- Delete Milestone
- List Tasks
- Create Task
- Review Task
- List Timesheets
- Create Timesheet Entry
- Update Timesheet Entry
- Delete Timesheet Entry
- Review Timesheet
- List Invoice Adjustments
- Create Invoice Adjustment
- Delete Invoice Adjustment
- Review Invoice Adjustment
- List Off-Cycle Payments
- Create Off-Cycle Payment

### EOR
- Calculate Employee Cost
- Get Hiring Guide
- Get EOR Start Date
- List EOR Benefits
- List Job Scope Templates
- Validate Job Scope
- Create EOR Contract
- Accept EOR Quote
- Sign EOR Contract
- Cancel EOR Contract
- Delay EOR Onboarding
- Fetch EOR Contract Document
- Request EOR Termination
- Get Termination Details
- List EOR Payslips
- Download Payslip PDF
- List Employee Compliance Documents

### Time Off
- List Time Off Requests
- Create Time Off Request
- Update Time Off Request
- Cancel Time Off Request
- Review Time Off Request
- Validate Time Off Request
- List Time Off Policies
- Get Entitlements
- Get Work Schedule and Holidays

### Adjustments
- List Adjustments
- Get Adjustment
- Create Adjustment
- Update Adjustment
- Delete Adjustment

### Global Payroll
- List GP Employees
- Update GP Employee Information
- Update GP Compensation
- Update GP Address
- Request GP Termination
- List Payroll Cycles
- Get Gross to Net Report
- List Shifts
- Create Shifts
- Delete Shift
- List GP Payslips

### ATS
- List Jobs
- Get Job
- Create Job
- List Candidates
- Create Candidate
- Add Candidate Tags
- List Applications
- Get Application
- Create Application
- Add Application Note
- Move Application to Stage
- List Offers

### Immigration & Screenings
- Check Visa Requirements
- Get Visa Types
- List Immigration Cases
- Get Immigration Case
- Get Worker KYC
- Create Veriff Session

### IT, Knowledge Hub & Access
- List IT Orders
- List IT Assets
- List IT Hardware Policies
- Get Country Hiring Guide
- Create Magic Link

### Invoices
- List Invoices
- Get Invoice
- Download Invoice PDF
- List Refund Statements

## List of Triggers

- On Deel Event

## Authentication

This service uses **OAuth2**. Connect a Deel account from the connection settings before using any action.

## Configuration

- **Client ID** (required) — OAuth2 Client ID from your Deel developer app (More → Developer → Apps).
- **Client Secret** (required) — OAuth2 Client Secret from your Deel developer app.
- **Environment** (required) — `Production` for live data or `Sandbox` for Deel's demo environment. Defaults to `Production`.

## Agent Ideas

- When a **Deel** "On Deel Event" trigger fires for `eor.payslips.available`, use **Deel** "Download Payslip PDF" to fetch the document, then **Gmail** "Send Message" to email it to the employee.
- Use **Personio** to read newly hired employees, then call **Deel** "Create Direct Employee" (or "Create Contractor Contract") to provision each worker in Deel.
- When a **Deel** "On Deel Event" trigger fires for `contract.signed`, use **Slack** "Send Message To Channel" to notify the People Ops channel and **Google Sheets** "Add Row" to log the new hire in an onboarding tracker.
