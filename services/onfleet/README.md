# Onfleet FlowRunner Extension

Last-mile delivery management for FlowRunner. Create and dispatch delivery tasks, manage drivers (workers) and teams, define reusable destinations and recipients, and auto-dispatch routes — all backed by the [Onfleet API v2](https://docs.onfleet.com/). Authenticates with **HTTP Basic auth** using your Onfleet API key as the username and an empty password.

## Ideal Use Cases

- Turn incoming e-commerce or CRM orders into Onfleet delivery tasks with the correct destination and recipient
- Onboard drivers and organize them into teams, then auto-dispatch and optimize their routes
- Maintain reusable destinations and recipients so repeat deliveries skip re-geocoding and re-typing customer details
- Track task status, complete or delete tasks, and share tracking URLs with customers
- Confirm connectivity and read organization settings before running delivery automations

## List of Actions

### Tasks
- Create Task, Get Task, Get Task by Short ID, List Tasks, Update Task, Complete Task, Delete Task

### Workers
- List Workers, Get Worker, Create Worker, Update Worker, Delete Worker, Get Worker Schedule

### Teams
- List Teams, Get Team, Create Team, Get Team's Tasks, Auto-Dispatch Team

### Destinations
- Create Destination, Get Destination

### Recipients
- Create Recipient, Get Recipient by Name, Get Recipient by Phone, Update Recipient

### Hubs
- List Hubs

### Organization
- Get Organization Details

## List of Triggers

This service does not define any triggers.

## Authentication

Onfleet uses **HTTP Basic authentication** with your API key as the username and an empty password (`base64('{apiKey}:')`); this service builds that header for you.

| Config item | Required | Description |
| ----------- | -------- | ----------- |
| **API Key** | Yes | Your Onfleet API key. Create one in **Onfleet → Settings → API → create an API Key**. |

Use **Get Organization Details** as a quick connection check to confirm your key is valid.

## Data Model

Onfleet organizes last-mile delivery around a few core objects:

- **Task** — the unit of work: one destination and (optionally) one recipient, assigned to a worker for completion. Tasks move through states: `Unassigned` (0), `Assigned` (1), `Active` (2), `Completed` (3).
- **Worker** — a driver. Belongs to one or more teams and has a vehicle.
- **Team** — a group of workers, optionally tied to a hub, that can be auto-dispatched.
- **Destination** — a geocoded delivery location (address + `[longitude, latitude]`).
- **Recipient** — the end customer receiving a delivery (name + phone).
- **Hub** — a physical dispatch location (warehouse/store).

The **Get Workers Dictionary** and **Get Teams Dictionary** pickers back the worker/team selection parameters (option value = the Onfleet worker/team ID).

## Inline vs. Referenced Destinations and Recipients

When creating a task you can supply the destination and recipient two ways:

- **Referenced by ID** — pass an existing **Destination ID** / **Recipient ID**. Create these ahead of time with *Create Destination* / *Create Recipient* to avoid re-geocoding the same location or re-typing customer details.
- **Inline** — leave the ID empty and provide the details directly on the task:
  - Destination: a structured **Address** object and/or **Coordinates**. Coordinates are `[longitude, latitude]` — **longitude first**.
  - Recipient: **Recipient Name** and **Recipient Phone** (international format, e.g. `+14155550100`).

Onfleet creates the destination/recipient records for you when supplied inline.

## Notes

Onfleet returns errors as `{ message: { error, message, cause, request } }`. This service surfaces the human-readable `message` and `cause` along with the HTTP status, e.g. `Onfleet API error: The provided phone number is invalid. - Include a country code (status 400)`.

## Agent Ideas

- When a new **Shopify** order arrives (**Get List of Orders** / **Get Order**), call Onfleet **Create Task** with the customer's inline destination address and `[longitude, latitude]` coordinates to schedule a same-day delivery
- After Onfleet **Auto-Dispatch Team** assigns routes, use **Twilio** "Send SMS" to text each customer their tracking URL returned by **Get Task**
- When a **WooCommerce** order ships (**Get Order** / **List Orders**), create the delivery via Onfleet **Create Task** and log the resulting task ID and short ID to **Google Sheets** "Add Row" for reconciliation
