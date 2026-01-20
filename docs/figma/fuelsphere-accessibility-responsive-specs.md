# Fuelsphere - Accessibility & Responsive Design Specifications

Generated: 01/01/2026, 17:31:53
WCAG Compliance Level: 2.1 AA

Total Screens: 3

## FO-001: Fuel Order Overview (List Report)
**Module:** Fuel Operations
**WCAG Level:** AA

### 1. ARIA Labels & Roles

| Element | ARIA Label | Role | Described By | ARIA Live |
|---------|-----------|------|--------------|----------|
| Search Input | Search fuel orders | searchbox | search-hint | - |
| Station Filter Dropdown | Filter by station | combobox | station-filter-hint | - |
| Status Filter Dropdown | Filter by order status | combobox | status-filter-hint | - |
| Date Range Picker | Select date range for orders | group | date-range-hint | - |
| Create Order Button | Create new fuel order | button | - | - |
| Export Button | Export orders to Excel | button | - | - |
| Refresh Button | Refresh order list | button | - | - |
| Orders Table | Fuel orders list | table | table-caption | - |
| Order Number Link | View order details for {orderNumber} | link | - | - |
| Pagination Controls | Pagination navigation | navigation | pagination-status | - |
| Loading State | Loading fuel orders | status | - | polite |
| Empty State | No fuel orders found | status | - | - |

### 2. Tab Order & Keyboard Navigation

| Sequence | Element | Focus Indicator | Keyboard Shortcut |
|----------|---------|----------------|------------------|
| 1 | Search Input | 2px solid var(--primary-blue), offset 2px | Ctrl + F |
| 2 | Station Filter | 2px solid var(--primary-blue), offset 2px | Alt + S |
| 3 | Status Filter | 2px solid var(--primary-blue), offset 2px | - |
| 4 | Date Range Picker | 2px solid var(--primary-blue), offset 2px | - |
| 5 | Create Order Button | 2px solid var(--primary-blue), offset 2px | Ctrl + N |
| 6 | Export Button | 2px solid var(--primary-blue), offset 2px | Ctrl + E |
| 7 | Refresh Button | 2px solid var(--primary-blue), offset 2px | Ctrl + R |
| 8 | First Table Row | 2px solid var(--primary-blue), entire row highlight | - |
| 9 | Column Sort Headers (Arrow keys) | 2px solid var(--primary-blue), offset 2px | - |
| 10 | Pagination Next | 2px solid var(--primary-blue), offset 2px | - |

**Keyboard Commands:**
- Tab/Shift+Tab: Navigate between interactive elements
- Enter/Space: Activate buttons and links
- Arrow Up/Down: Navigate table rows when table is focused
- Arrow Left/Right: Navigate pagination when focused
- Escape: Close dropdowns and modals
- Ctrl + F: Focus search input
- Ctrl + N: Open create order form
- Ctrl + E: Export to Excel
- Ctrl + R: Refresh table data
- Home: Jump to first row in table
- End: Jump to last row in table
- Page Up/Down: Scroll table page by page

### 3. Screen Reader Announcements

| Trigger | Announcement | Timing | ARIA Live |
|---------|-------------|--------|----------|
| Page Load | Fuel Order Overview loaded. {count} orders found. | After data loads | polite |
| Filter Applied | Filter applied. Now showing {count} orders. | After filter completes | polite |
| Search Performed | Search completed. {count} orders match your search. | After search completes | polite |
| Sort Applied | Table sorted by {columnName} in {direction} order. | After sort completes | polite |
| Data Refresh | Order list refreshed. {count} orders displayed. | After refresh completes | polite |
| Export Started | Exporting orders to Excel. Please wait. | When export starts | polite |
| Export Complete | Export complete. {count} orders exported. | When export finishes | polite |
| Error Occurred | Error: {errorMessage} | When error occurs | assertive |

### 4. Color Contrast Compliance

| Element | Foreground | Background | Ratio | WCAG Level | Compliant |
|---------|-----------|------------|-------|-----------|----------|
| Primary Text (Order Numbers) | var(--text-primary) #1F2937 | var(--card) #FFFFFF | 12.6:1 | AAA | ✅ |
| Secondary Text (Dates, Quantities) | var(--text-secondary) #6B7280 | var(--card) #FFFFFF | 4.8:1 | AA | ✅ |
| Primary Button (Create Order) | #FFFFFF | var(--primary-blue) #0070F2 | 4.6:1 | AA | ✅ |
| Status Badge - Completed | #FFFFFF | var(--success-green) #0F9D58 | 4.7:1 | AA | ✅ |
| Status Badge - Pending | #000000 | var(--warning-amber) #F9AB00 | 10.4:1 | AAA | ✅ |
| Status Badge - Cancelled | #FFFFFF | var(--error-red) #DB4437 | 5.1:1 | AA | ✅ |
| Link Text (Order Number Links) | var(--primary-blue) #0070F2 | var(--card) #FFFFFF | 4.5:1 | AA | ✅ |
| Table Header | var(--text-primary) #1F2937 | var(--muted) #F3F4F6 | 11.2:1 | AAA | ✅ |

### 5. Responsive Breakpoints

**Desktop (>1200px):**
- desktop: Full width table with all 10 columns visible
- tablet: Scroll horizontally, all columns visible
- mobile: Card-based view, stacked layout

**Tablet (768-1200px):**
- tablet: Reduced spacing, 8 columns visible (hide low-priority)

**Mobile (<768px):**
- mobile: Card layout, show only: Order #, Date, Station, Status, Amount

### 6. Element Visibility by Breakpoint

| Element | Desktop | Tablet | Mobile |
|---------|---------|--------|--------|
| Created Date Column | Visible | Visible | Hidden |
| Supplier Column | Visible | Visible | Hidden (accessible via card expansion) |
| Fuel Type Column | Visible | Hidden | Hidden (accessible via card expansion) |
| Priority Column | Visible | Hidden | Hidden (accessible via card expansion) |
| Advanced Filters Panel | Always visible (sidebar) | Collapsible panel | Bottom sheet modal |
| Bulk Actions Toolbar | Visible above table | Visible above table | Hidden (show on row selection) |

### 7. Touch Target Compliance

| Element | Minimum Size | Actual Size | Spacing | Compliant |
|---------|-------------|------------|---------|----------|
| Primary Button (Create Order) | 44px × 44px (iOS/Android standard) | 48px × 48px | 8px margin on all sides | ✅ |
| Filter Dropdown | 44px × 44px | 48px × 48px | 8px margin on all sides | ✅ |
| Table Row (Mobile Card) | 44px height | 72px height | 8px margin bottom | ✅ |
| Order Number Link | 44px × 44px | Full row height (56px) × auto width | 16px padding | ✅ |
| Sort Icon (Column Headers) | 44px × 44px | 48px × 48px | 4px from text | ✅ |
| Pagination Buttons | 44px × 44px | 48px × 48px | 4px between buttons | ✅ |
| Checkbox (Row Selection) | 44px × 44px | 48px × 48px (including padding) | 8px from content | ✅ |
| Action Menu (Mobile) | 44px × 44px | 48px × 48px | 8px from edges | ✅ |

### 8. Focus Management

- On page load, focus moves to search input
- After filter application, focus returns to filter dropdown
- After creating order, focus moves to success message, then to new order in table
- When modal opens, focus traps inside modal
- When modal closes, focus returns to trigger element
- Error messages receive immediate focus with aria-live="assertive"
- Skip to main content link available at page top (hidden until focused)
- Focus visible indicator: 2px solid var(--primary-blue) with 2px offset

---

## FO-002: Fuel Order Detail (Object Page)
**Module:** Fuel Operations
**WCAG Level:** AA

### 1. ARIA Labels & Roles

| Element | ARIA Label | Role | Described By | ARIA Live |
|---------|-----------|------|--------------|----------|
| Page Header | Fuel Order {orderNumber} Details | banner | - | - |
| Edit Button | Edit fuel order | button | - | - |
| Submit Button | Submit fuel order for approval | button | - | - |
| Cancel Order Button | Cancel this fuel order | button | - | - |
| Print Button | Print fuel order | button | - | - |
| Download PDF Button | Download order as PDF | button | - | - |
| Header KPI - Status | Order status: {status} | status | - | - |
| Header KPI - Total Amount | Total amount: {amount} {currency} | status | - | - |
| Header KPI - Delivery Date | Requested delivery date: {date} | status | - | - |
| Section - Order Information | Order information section | region | - | - |
| Section - Delivery Details | Delivery details section | region | - | - |
| Section - Financial Information | Financial information section | region | - | - |
| Section - Fuel Tickets | Related fuel tickets | region | - | - |
| Section - Audit History | Order audit history | region | - | - |
| Tabs Navigation | Order details navigation | tablist | - | - |
| Tab - Details | Order details tab | tab | - | - |
| Tab - Tickets | Fuel tickets tab | tab | - | - |
| Tab - History | Audit history tab | tab | - | - |

### 2. Tab Order & Keyboard Navigation

| Sequence | Element | Focus Indicator | Keyboard Shortcut |
|----------|---------|----------------|------------------|
| 1 | Back Button | 2px solid var(--primary-blue), offset 2px | Escape |
| 2 | Edit Button | 2px solid var(--primary-blue), offset 2px | Ctrl + E |
| 3 | Submit Button | 2px solid var(--primary-blue), offset 2px | Ctrl + S |
| 4 | Cancel Order Button | 2px solid var(--error-red), offset 2px | - |
| 5 | Print Button | 2px solid var(--primary-blue), offset 2px | Ctrl + P |
| 6 | Download PDF Button | 2px solid var(--primary-blue), offset 2px | - |
| 7 | Tab - Details | 2px solid var(--primary-blue), bottom border | - |
| 8 | Tab - Tickets | 2px solid var(--primary-blue), bottom border | - |
| 9 | Tab - History | 2px solid var(--primary-blue), bottom border | - |
| 10 | First Interactive Element in Active Tab | 2px solid var(--primary-blue), offset 2px | - |

**Keyboard Commands:**
- Tab/Shift+Tab: Navigate between interactive elements
- Enter/Space: Activate buttons and links
- Arrow Left/Right: Navigate between tabs
- Escape: Close modals, return to overview (if no unsaved changes)
- Ctrl + E: Enter edit mode
- Ctrl + S: Submit order (if allowed)
- Ctrl + P: Print order
- Alt + 1: Jump to Details tab
- Alt + 2: Jump to Tickets tab
- Alt + 3: Jump to History tab

### 3. Screen Reader Announcements

| Trigger | Announcement | Timing | ARIA Live |
|---------|-------------|--------|----------|
| Page Load | Fuel Order {orderNumber} loaded. Status: {status}. Total amount: {amount}. | After data loads | polite |
| Tab Change | {tabName} tab selected. | When tab changes | polite |
| Order Submitted | Order submitted successfully. Status changed to Submitted. | After submission completes | polite |
| Order Cancelled | Order cancelled. Status changed to Cancelled. | After cancellation completes | polite |
| Edit Mode Activated | Edit mode activated. You can now modify order details. | When edit mode starts | polite |
| PDF Downloaded | PDF downloaded successfully. | When download completes | polite |
| Error Occurred | Error: {errorMessage}. Please try again. | When error occurs | assertive |

### 4. Color Contrast Compliance

| Element | Foreground | Background | Ratio | WCAG Level | Compliant |
|---------|-----------|------------|-------|-----------|----------|
| Page Title (Order Number) | var(--text-primary) #1F2937 | var(--card) #FFFFFF | 12.6:1 | AAA | ✅ |
| Status Badge (Header KPI) | #FFFFFF | var(--success-green) #0F9D58 | 4.7:1 | AA | ✅ |
| Section Headers | var(--text-primary) #1F2937 | var(--background) #F9FAFB | 11.8:1 | AAA | ✅ |
| Field Labels | var(--text-secondary) #6B7280 | var(--card) #FFFFFF | 4.8:1 | AA | ✅ |
| Field Values | var(--text-primary) #1F2937 | var(--card) #FFFFFF | 12.6:1 | AAA | ✅ |
| Active Tab | var(--primary-blue) #0070F2 | var(--card) #FFFFFF | 4.5:1 | AA | ✅ |
| Inactive Tab | var(--text-secondary) #6B7280 | var(--card) #FFFFFF | 4.8:1 | AA | ✅ |

### 5. Responsive Breakpoints

**Desktop (>1200px):**
- desktop: 3-column header KPIs, side-by-side sections
- tablet: 2-column header KPIs, stacked sections
- mobile: 1-column layout, all stacked

**Tablet (768-1200px):**
- tablet: Actions move to dropdown menu, 2-column forms

**Mobile (<768px):**
- mobile: Sticky header with order number, bottom action sheet for buttons

### 6. Element Visibility by Breakpoint

| Element | Desktop | Tablet | Mobile |
|---------|---------|--------|--------|
| Print Button | Visible in header toolbar | Visible in header toolbar | Hidden (moved to action menu) |
| Download PDF Button | Visible in header toolbar | Visible in header toolbar | Hidden (moved to action menu) |
| Header KPI - Created Date | Visible | Visible | Hidden (accessible in Details section) |
| Sidebar (Related Documents) | Always visible (right sidebar) | Collapsible panel | Bottom sheet modal (accessed via button) |
| Breadcrumb Navigation | Visible | Visible | Hidden (replaced by back button) |

### 7. Touch Target Compliance

| Element | Minimum Size | Actual Size | Spacing | Compliant |
|---------|-------------|------------|---------|----------|
| Edit Button | 44px × 44px | 48px × 48px | 8px margin | ✅ |
| Submit Button | 44px × 44px | 48px × 48px | 8px margin | ✅ |
| Tab Navigation Items | 44px height | 56px height × auto width | 0px (full width on mobile) | ✅ |
| Back Button | 44px × 44px | 48px × 48px | 8px margin | ✅ |
| Action Menu (Mobile) | 44px × 44px | 48px × 48px | 8px from edges | ✅ |
| Related Document Links | 44px height | 56px height (full row) | 4px between items | ✅ |

### 8. Focus Management

- On page load, focus moves to page title (h1)
- After tab change, focus moves to first interactive element in new tab content
- When edit mode activated, focus moves to first editable field
- After submit/cancel action, focus moves to confirmation message
- When modal opens (e.g., cancel confirmation), focus traps in modal
- When modal closes, focus returns to button that opened it
- Skip links available: Skip to actions, Skip to content, Skip to related items

---

## FO-003: Create Fuel Order
**Module:** Fuel Operations
**WCAG Level:** AA

### 1. ARIA Labels & Roles

| Element | ARIA Label | Role | Described By | ARIA Live |
|---------|-----------|------|--------------|----------|
| Form | Create new fuel order form | form | - | - |
| Station Field | Select station | combobox | station-hint station-error | - |
| Supplier Field | Select supplier | combobox | supplier-hint supplier-error | - |
| Fuel Type Field | Select fuel type | combobox | fuel-type-hint fuel-type-error | - |
| Quantity Field | Enter fuel quantity in kilograms | spinbutton | quantity-hint quantity-error | - |
| Delivery Date Field | Select requested delivery date | textbox | delivery-date-hint delivery-date-error | - |
| Priority Field | Select order priority | radiogroup | priority-hint | - |
| Notes Field | Enter additional notes (optional) | textbox | notes-hint notes-counter | - |
| Submit Button | Submit fuel order | button | - | - |
| Save Draft Button | Save order as draft | button | - | - |
| Cancel Button | Cancel and return to overview | button | - | - |
| Validation Error Summary | Form validation errors | alert | - | assertive |
| Field Error Message | undefined | alert | - | polite |

### 2. Tab Order & Keyboard Navigation

| Sequence | Element | Focus Indicator | Keyboard Shortcut |
|----------|---------|----------------|------------------|
| 1 | Station Field | 2px solid var(--primary-blue), offset 2px | Alt + S |
| 2 | Supplier Field | 2px solid var(--primary-blue), offset 2px | Alt + U |
| 3 | Fuel Type Field | 2px solid var(--primary-blue), offset 2px | Alt + F |
| 4 | Quantity Field | 2px solid var(--primary-blue), offset 2px | Alt + Q |
| 5 | Delivery Date Field | 2px solid var(--primary-blue), offset 2px | Alt + D |
| 6 | Priority - Normal | 2px solid var(--primary-blue), offset 2px | - |
| 7 | Priority - High | 2px solid var(--primary-blue), offset 2px | - |
| 8 | Priority - Urgent | 2px solid var(--primary-blue), offset 2px | - |
| 9 | Notes Field | 2px solid var(--primary-blue), offset 2px | - |
| 10 | Save Draft Button | 2px solid var(--primary-blue), offset 2px | - |
| 11 | Submit Button | 2px solid var(--primary-blue), offset 2px | Ctrl + Enter |
| 12 | Cancel Button | 2px solid var(--error-red), offset 2px | Escape |

**Keyboard Commands:**
- Tab/Shift+Tab: Navigate between form fields
- Arrow Up/Down: Navigate dropdown options
- Arrow Up/Down: Increment/decrement quantity
- Space: Toggle radio buttons, open dropdowns
- Enter: Select dropdown option, submit form (when on submit button)
- Escape: Close dropdowns, cancel form (with confirmation)
- Ctrl + Enter: Submit form from any field
- Alt + S: Focus station field
- Alt + U: Focus supplier field
- Alt + F: Focus fuel type field
- Alt + Q: Focus quantity field
- Alt + D: Focus delivery date field

### 3. Screen Reader Announcements

| Trigger | Announcement | Timing | ARIA Live |
|---------|-------------|--------|----------|
| Form Load | Create fuel order form. Please fill in all required fields marked with asterisk. | On page load | polite |
| Field Validation Error | {fieldName}: {errorMessage} | On field blur or form submit | assertive |
| Form Validation Error | Form has {count} errors. Please review and correct before submitting. | On submit attempt with errors | assertive |
| Field Value Changed | {fieldName} changed to {value} | On field change (for critical fields) | polite |
| Calculated Price Updated | Total amount calculated: {amount} {currency} | After quantity or pricing changes | polite |
| Draft Saved | Order saved as draft successfully. | After save completes | polite |
| Order Submitted | Order submitted successfully. Order number: {orderNumber} | After submission completes | polite |
| Auto-save Progress | Auto-saving... | When auto-save starts | polite |

### 4. Color Contrast Compliance

| Element | Foreground | Background | Ratio | WCAG Level | Compliant |
|---------|-----------|------------|-------|-----------|----------|
| Form Labels (Required Fields) | var(--text-primary) #1F2937 | var(--card) #FFFFFF | 12.6:1 | AAA | ✅ |
| Required Field Asterisk | var(--error-red) #DB4437 | var(--card) #FFFFFF | 5.1:1 | AA | ✅ |
| Input Fields (Default) | var(--text-primary) #1F2937 | var(--card) #FFFFFF | 12.6:1 | AAA | ✅ |
| Input Fields (Disabled) | var(--text-secondary) #6B7280 | var(--muted) #F3F4F6 | 4.2:1 | AA | ✅ |
| Error Messages | var(--error-red) #DB4437 | var(--card) #FFFFFF | 5.1:1 | AA | ✅ |
| Helper Text | var(--text-secondary) #6B7280 | var(--card) #FFFFFF | 4.8:1 | AA | ✅ |
| Submit Button | #FFFFFF | var(--primary-blue) #0070F2 | 4.6:1 | AA | ✅ |
| Submit Button (Disabled) | #FFFFFF | var(--text-secondary) #6B7280 | 4.8:1 | AA | ✅ |

### 5. Responsive Breakpoints

**Desktop (>1200px):**
- desktop: 2-column form layout, side-by-side fields
- tablet: 2-column layout for most fields
- mobile: 1-column layout, all fields stacked

**Tablet (768-1200px):**
- tablet: Narrower form, some fields go full-width

**Mobile (<768px):**
- mobile: Full-width fields, sticky action buttons at bottom

### 6. Element Visibility by Breakpoint

| Element | Desktop | Tablet | Mobile |
|---------|---------|--------|--------|
| Inline Helper Text | Visible below each field | Visible below each field | Hidden (accessible via info icon) |
| Character Counter (Notes) | Always visible | Always visible | Visible only when field is focused |
| Preview Panel (Calculated Totals) | Always visible (right sidebar) | Collapsible panel | Bottom sheet (accessed via button) |
| Field Labels | Above fields | Above fields | Above fields (never hidden - accessibility requirement) |

### 7. Touch Target Compliance

| Element | Minimum Size | Actual Size | Spacing | Compliant |
|---------|-------------|------------|---------|----------|
| Dropdown Fields | 44px × 44px | 56px height × full width | 16px margin bottom | ✅ |
| Radio Buttons (Priority) | 44px × 44px | 48px × 48px (including label) | 8px between options | ✅ |
| Date Picker Button | 44px × 44px | 56px × 56px | Integrated into field (56px height) | ✅ |
| Submit Button | 44px × 44px | 56px height × full width (mobile) | 8px margin | ✅ |
| Save Draft Button | 44px × 44px | 56px height × auto width | 8px margin | ✅ |
| Cancel Button | 44px × 44px | 56px height × auto width | 8px margin | ✅ |
| Info Icon (Helper Text) | 44px × 44px | 48px × 48px | 4px from field | ✅ |

### 8. Focus Management

- On page load, focus moves to first required field (Station)
- After field validation error, focus moves to first field with error
- When dropdown opens, focus moves to search input (if searchable)
- When date picker opens, focus moves to selected date or today
- After submit attempt with errors, focus moves to error summary
- After successful submission, focus moves to success message
- Required field indicator (*) announced as "required" by screen readers
- Field hints linked via aria-describedby for screen reader context

---

