# Fuelsphere - Screen Interaction Documentation

Generated: 12/01/2026, 19:11:29

Total Screens: 3

## FO-001: Fuel Order Overview (List Report)
**Module:** Fuel Operations

### 1. User Actions

| Action | Trigger Element | Event Type | Result/Navigation | Conditions |
|--------|----------------|------------|-------------------|------------|
| Search Orders | Search Bar | onChange | Filter table results | Min 3 characters |
| Filter by Station | Station Dropdown | onSelect | Refresh table with filtered data | Active stations only |
| Filter by Status | Status Dropdown | onSelect | Refresh table with filtered data | All status values |
| Filter by Date Range | Date Range Picker | onDateChange | Refresh table with filtered data | Max 12 months range |
| View Order Details | Order Number (Link) | onClick | Navigate to Fuel Order Detail (FO-002) | User has view permission |
| Create New Order | Create Button | onClick | Navigate to Create Fuel Order (FO-003) | User has create permission |
| Export to Excel | Export Button | onClick | Download Excel file | Max 10,000 records |
| Sort Column | Column Header | onClick | Sort table asc/desc | None |
| Paginate | Pagination Controls | onClick | Load next/prev page | None |
| Refresh Data | Refresh Button | onClick | Reload table data | None |

### 2. State Transitions

**Initial State:** Loading - Display skeleton table

**Possible States:** Loading, Loaded, Empty, Error, Filtering

**Transition Triggers:**
- Loading → Loaded: API success with data
- Loading → Empty: API success with no data
- Loading → Error: API failure
- Loaded → Filtering: User applies filter
- Filtering → Loaded: Filter applied, results returned

**Visual Feedback:**
- Loading: Skeleton loaders, disabled buttons
- Loaded: Full table with data, all actions enabled
- Empty: Empty state illustration, "No orders found"
- Error: Error message banner, retry button
- Filtering: Loading spinner in filter bar

### 3. Validation Rules

**Search Input:**
- Min 3 characters for search → "Please enter at least 3 characters"
**Date Range:**
- Start date < End date → "Start date must be before end date"
- Max range 12 months → "Maximum date range is 12 months"

### 4. API Calls Required

**Get Fuel Orders:**
- Method: GET
- Endpoint: /odata/v4/FuelOrder?$expand=station,supplier,fuelType
- Request: Query params: $filter, $top, $skip, $orderby, $search
- Response: { value: FuelOrder[], @odata.count: number }
- OData Action: Query with $filter and $expand

**Get Stations:**
- Method: GET
- Endpoint: /odata/v4/Airport?$select=ID,iataCode,name
- Request: Query params: $filter=status eq 'Active'
- Response: { value: Airport[] }

**Get Suppliers:**
- Method: GET
- Endpoint: /odata/v4/Supplier?$select=ID,supplierCode,supplierName
- Request: Query params: $filter=status eq 'Active'
- Response: { value: Supplier[] }

### 5. Navigation Map

**Entry Points:**
- Fuelsphere Launchpad → Fuel Order Overview tile
- Fuel Dashboard → "View All Orders" button
- Fuel Order Detail → Back button

**Exit Points:**
- Order Number link → Fuel Order Detail (FO-002)
- Create button → Create Fuel Order (FO-003)
- Back to Home → Fuelsphere Launchpad

**Deep Linking Parameters:**
- ?station={stationId}
- ?status={status}
- ?dateFrom={date}&dateTo={date}
- ?orderId={orderId}

---

## FO-002: Fuel Order Detail (Object Page - Display)
**Module:** Fuel Operations

### 1. User Actions

| Action | Trigger Element | Event Type | Result/Navigation | Conditions |
|--------|----------------|------------|-------------------|------------|
| Edit Order | Edit Button | onClick | Switch to Edit Mode (FO-004) | Status = Draft or Pending, User has edit permission |
| Submit Order | Submit Button | onClick | Status → Submitted, Refresh page | Status = Draft, All required fields filled |
| Cancel Order | Cancel Button | onClick | Status → Cancelled, Show confirmation | Status ≠ Delivered or Invoiced, User has cancel permission |
| View Fuel Tickets | Fuel Tickets Tab | onClick | Expand Fuel Tickets section | Order has tickets |
| View Invoice | Invoice Link | onClick | Navigate to Invoice Detail | Invoice exists |
| View PO | PO Link | onClick | Navigate to Purchase Order Detail | PO created (ePOD triggered) |
| View GR | GR Link | onClick | Navigate to Goods Receipt Detail | GR created (ePOD triggered) |
| Print Order | Print Button | onClick | Open print dialog | None |
| Download PDF | Download Button | onClick | Generate and download PDF | None |
| View History | History Tab | onClick | Show audit trail | None |

### 2. State Transitions

**Initial State:** Loading - Display skeleton

**Possible States:** Loading, Display, Saving, Error, Cancelled

**Transition Triggers:**
- Loading → Display: API success
- Loading → Error: API failure or 404
- Display → Saving: User clicks Submit/Cancel
- Saving → Display: Save success
- Saving → Error: Save failure
- Display → Cancelled: User cancels order

**Visual Feedback:**
- Loading: Skeleton loaders for all sections
- Display: Full content, action buttons enabled
- Saving: Loading overlay, buttons disabled
- Error: Error banner, retry button
- Cancelled: Status badge shows Cancelled, restricted actions

### 3. Validation Rules


### 4. API Calls Required

**Get Fuel Order:**
- Method: GET
- Endpoint: /odata/v4/FuelOrder({ID})?$expand=station,supplier,fuelType,contract,tickets,invoice,purchaseOrder,goodsReceipt
- Request: Path param: ID
- Response: { ID, orderNumber, orderDate, station: {...}, supplier: {...}, ... }
- OData Action: Query with deep $expand

**Submit Order:**
- Method: POST
- Endpoint: /odata/v4/FuelOrder({ID})/submit
- Request: {}
- Response: { success: true, message: "Order submitted" }
- OData Action: Custom action

**Cancel Order:**
- Method: POST
- Endpoint: /odata/v4/FuelOrder({ID})/cancel
- Request: { reason: string }
- Response: { success: true, message: "Order cancelled" }
- OData Action: Custom action

**Get Audit Trail:**
- Method: GET
- Endpoint: /odata/v4/AuditTrail?$filter=entityType eq 'FuelOrder' and entityID eq '{ID}'
- Request: Query params: $filter
- Response: { value: AuditTrail[] }

### 5. Navigation Map

**Entry Points:**
- Fuel Order Overview → Order Number link
- Fuel Dashboard → Recent Orders widget
- Deep link with ?orderId={ID}

**Exit Points:**
- Edit button → Fuel Order Edit (FO-004)
- Back button → Fuel Order Overview (FO-001)
- Invoice link → Invoice Detail
- PO link → Purchase Order Detail
- GR link → Goods Receipt Detail
- Ticket link → Fuel Ticket Detail

**Deep Linking Parameters:**
- ?orderId={ID}
- ?tab=tickets
- ?tab=history
- ?action=edit

---

## FO-003: Create Fuel Order
**Module:** Fuel Operations

### 1. User Actions

| Action | Trigger Element | Event Type | Result/Navigation | Conditions |
|--------|----------------|------------|-------------------|------------|
| Select Station | Station Dropdown (Value Help) | onSelect | Populate station details, Load active suppliers | Active stations only |
| Select Supplier | Supplier Dropdown (Value Help) | onSelect | Populate contract details, Load pricing | Active suppliers at selected station |
| Select Fuel Type | Fuel Type Dropdown | onSelect | Update pricing based on fuel type | Available fuel types for station |
| Enter Quantity | Quantity Input (kg) | onChange | Calculate total amount | Numeric, > 0, Max based on aircraft capacity |
| Select Delivery Date | Date Picker | onDateChange | Validate against contract terms | Must be future date, Within contract validity |
| Select Priority | Priority Radio Buttons | onChange | Update priority field | Options: Normal, High, Urgent |
| Add Notes | Notes Textarea | onChange | Update notes field | Max 1000 characters |
| Save as Draft | Save as Draft Button | onClick | Save order, Navigate to Detail (FO-002) | Station and Supplier selected |
| Submit Order | Submit Button | onClick | Validate, Save, Submit, Navigate to Detail | All required fields valid |
| Cancel | Cancel Button | onClick | Show confirmation, Navigate to Overview (FO-001) | None |

### 2. State Transitions

**Initial State:** Empty Form - All fields blank

**Possible States:** Empty, Filling, Validating, Saving, Success, Error

**Transition Triggers:**
- Empty → Filling: User starts entering data
- Filling → Validating: User clicks Save or Submit
- Validating → Saving: All validations pass
- Validating → Filling: Validation errors found
- Saving → Success: Save API success
- Saving → Error: Save API failure

**Visual Feedback:**
- Empty: All fields empty, Submit disabled
- Filling: Real-time validation, Submit enabled when valid
- Validating: Loading indicator, all fields disabled
- Saving: Full-page loading overlay, buttons disabled
- Success: Success toast, Navigate to detail page
- Error: Error banner with retry option

### 3. Validation Rules

**Station:**
- Required → "Please select a station"
**Supplier:**
- Required → "Please select a supplier"
**Fuel Type:**
- Required → "Please select a fuel type"
**Quantity:**
- Required → "Quantity is required"
- Numeric → "Must be a number"
- Min 100 kg → "Minimum 100 kg"
- Max 100,000 kg → "Maximum 100,000 kg"
**Delivery Date:**
- Required → "Delivery date is required"
- Must be future date → "Date must be in the future"
- Within contract validity → "Date must be within contract validity period"
**Priority:**
- Required → "Please select a priority"
**Notes:**
- Max 1000 characters → "Notes cannot exceed 1000 characters"
**Form:**
- Supplier must have active contract at station → "No active contract found for selected supplier at this station"
- Contract must be valid on delivery date → "Contract is not valid for the selected delivery date"

### 4. API Calls Required

**Get Active Stations:**
- Method: GET
- Endpoint: /odata/v4/Airport?$filter=status eq 'Active'&$select=ID,iataCode,name
- Request: None
- Response: { value: Airport[] }

**Get Suppliers by Station:**
- Method: GET
- Endpoint: /odata/v4/Supplier?$filter=status eq 'Active'&$expand=contracts($filter=station_ID eq {stationId} and status eq 'Active')
- Request: Query param: stationId
- Response: { value: Supplier[] }

**Get Fuel Types:**
- Method: GET
- Endpoint: /odata/v4/FuelType?$filter=status eq 'Active'
- Request: None
- Response: { value: FuelType[] }

**Get Pricing:**
- Method: GET
- Endpoint: /odata/v4/FuelContract({contractId})/getPricing
- Request: { fuelTypeId: string, deliveryDate: Date }
- Response: { unitPrice: Decimal, cpeIndex: Decimal, effectiveDate: Date }
- OData Action: Custom function

**Create Fuel Order (Draft):**
- Method: POST
- Endpoint: /odata/v4/FuelOrder
- Request: { station_ID, supplier_ID, fuelType_ID, quantity, deliveryDate, priority, status: "Draft", ... }
- Response: { ID, orderNumber, status: "Draft", ... }

**Create and Submit Fuel Order:**
- Method: POST
- Endpoint: /odata/v4/FuelOrder
- Request: { station_ID, supplier_ID, fuelType_ID, quantity, deliveryDate, priority, status: "Submitted", ... }
- Response: { ID, orderNumber, status: "Submitted", ... }

### 5. Navigation Map

**Entry Points:**
- Fuel Order Overview → Create button
- Fuel Dashboard → Quick Create widget
- Fuelsphere Launchpad → Create Fuel Order tile

**Exit Points:**
- Submit success → Fuel Order Detail (FO-002)
- Save Draft success → Fuel Order Detail (FO-002)
- Cancel → Fuel Order Overview (FO-001)

**Deep Linking Parameters:**
- ?station={stationId}
- ?supplier={supplierId}
- ?prefill=true

---

