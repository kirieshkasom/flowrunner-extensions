# BambooHR FlowRunner Extension

Connects to BambooHR over OAuth2 to automate the employee lifecycle: profiles, time off, time tracking, recruiting, training, goals, reports, files, and webhook-driven change events.

## Ideal Use Cases

- Automating onboarding and offboarding workflows
- Syncing employee data to payroll and business systems
- Building time off approval and notification flows
- Reacting in real time when an employee record changes
- Streamlining recruiting pipelines and candidate management
- Managing employee and company documents and file categories

## List of Actions

**Employee Management**
- Create Employee
- Get Changed Employee IDs
- Get Employee By ID
- Get Employee Directory
- List Employees
- Update Employee

**Company**
- Get Company Information

**Employee Data**
- Create Table Row
- Delete Table Row
- Get Employee Table Data
- Update Table Row

**Employee Files**
- Create Employee File Category
- Delete Employee File
- Download Employee File
- List Employee File Categories
- List Employee Files
- Update Employee File
- Upload Employee File

**Company Files**
- Create Company File Category
- Delete Company File
- Download Company File
- List Company Files
- Update Company File
- Upload Company File

**Employee Dependents**
- Create Employee Dependent
- List Employee Dependents
- Update Employee Dependent

**Time Off**
- Adjust Time Off Balance
- Create Time Off Request
- Get Time Off Balance
- List Employee Time Off Policies
- List Time Off Policies
- List Time Off Requests
- List Time Off Types
- List Who's Out
- Update Time Off Request Status

**Time Tracking**
- Clock In Employee
- Clock Out Employee
- Create or Update Hour Entries
- List Timesheet Entries

**Recruiting**
- Create Candidate Application
- Create Job Application Comment
- Get Applicant Statuses
- Get Job Application Details
- Get Job Applications
- Get Job Summaries
- Update Applicant Status

**Training**
- Create Employee Training Record
- List Employee Training Records
- List Training Types

**Reports**
- Request Custom Report

**Goals**
- Create Goal
- Delete Goal
- List Goals
- Update Goal Progress

**Metadata**
- List Fields
- List Tables Metadata
- List Users

**Webhooks**
- Create Webhook
- Delete Webhook
- Get Webhook
- Get Webhook Logs
- List Webhooks
- Update Webhook

## List of Triggers

- On Employee Changed

## Agent Ideas

- When a **BambooHR** "On Employee Changed" trigger fires, use **Gmail** "Send Message" to alert HR and IT so onboarding or offboarding tasks start immediately.
- Run **BambooHR** "List Who's Out" each morning and post the results with **Slack** "Send Message To Channel" as a team out-of-office summary.
- Use **BambooHR** "Get Employee Directory" to pull the roster, then write each record into a headcount tracker with **Google Sheets** "Add Row".
