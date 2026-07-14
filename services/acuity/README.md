# Acuity Scheduling FlowRunner Extension

Book, reschedule, and cancel appointments, look up open availability, and manage clients, appointment types, calendars, and intake forms through the Acuity Scheduling API (now part of Squarespace). Authenticates with HTTP Basic using your account's `userId:apiKey`.

## Ideal Use Cases

- Automatically book, reschedule, or cancel appointments from another system or workflow
- Check open availability (dates and times) before offering or confirming a booking
- Sync new appointments into a CRM, spreadsheet, or notification channel the moment they are booked
- Keep client records and intake form data up to date across tools
- Audit appointment types, calendars, and discount/gift certificates

## List of Actions

### Appointments
- Create Appointment
- Get Appointment
- List Appointments
- Reschedule Appointment
- Cancel Appointment
- Update Appointment

### Availability
- Check Times
- Get Availability Dates
- Get Availability Times

### Appointment Types
- List Appointment Types

### Calendars
- List Calendars

### Clients
- Create Client
- List Clients
- Update Client

### Forms
- List Forms

### Certificates
- List Certificates

### Account
- Get Me

## List of Triggers

- On New Appointment (polling)

## Notes

- **Authentication**: The service base64-encodes `userId:apiKey` and sends it as an `Authorization: Basic ...` header on every request. Both **User ID** and **API Key** are account-level (not shared) and are found in **Acuity → Integrations → API**. Use **Get Me** to verify the connection.
- **Scheduling model**: Appointment types define what can be booked (each has an `appointmentTypeID`); calendars represent the staff or resources appointments are booked against (each has a `calendarID`). Availability is derived from type + calendar — query open dates for a month, then open times for a date, then confirm with **Check Times** before booking. Creating an appointment as admin bypasses the public booking window.
- **Intake forms**: Attach custom fields to appointments; supply values via the Form Fields parameter as `{ "id": <fieldID>, "value": "..." }`. Use **List Forms** to discover field IDs.

## Agent Ideas

- When an **Acuity Scheduling** "On New Appointment" trigger fires, use **Gmail** "Send Message" to email the client a personalized confirmation with the scheduled time and any prep instructions.
- After booking with **Acuity Scheduling** "Create Appointment", call **Google Calendar** "Create Event" to mirror the appointment onto a staff member's calendar with the client's contact details.
- When an **Acuity Scheduling** "On New Appointment" trigger fires, use **HubSpot** "Create Contact" (or "Update Contact") to add or enrich the client record and log the booking in your CRM.
