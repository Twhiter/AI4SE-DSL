
# State Extraction — Examples and Anti-Examples

## Source Text (Amazon delivery)

"When a customer creates an order, the order is initially pending. After the payment is successfully validated, the order becomes paid. The warehouse can then ship the order, changing its state to shipped.

If the customer cancels the order before shipping, the order becomes cancelled. Once a shipped order reaches the customer, it becomes delivered.

An order may also be marked as flagged when the system detects suspicious activity. A flagged order can still be pending or paid.

The system displays a welcome message when the customer opens the order page. It also records the order creation date for reporting purposes."

---

## Example 1: Valid Lifecycle States

### Correct Extraction

- **Entity:** Order
- **States:**
  - created
  - paid
  - shipped
  - delivered
  - cancelled

### Explanation

These states are valid because:
- They describe meaningful lifecycle stages of an Order.
- Each state represents a condition the Order can be in.
- The states correspond to critical actions such as validating payment, shipping, delivering, and cancelling.
- State names use consistent adjective or participle forms.

---

## Example 2: Non-Exclusive States

### Correct Extraction

- **Entity:** Order
- **State:** flagged
---

## Anti-Example: Non-Critical State

### Incorrect Extraction

- **Entity:** Order
- **State:** viewed

### Source Text Reference

"The system displays a welcome message when the customer opens the order page."

### Explanation

- Opening the order page does not represent a meaningful lifecycle stage.
- The viewing activity has no stated impact on the critical order process.
- The state is not relevant to the domain workflow.
---

## Anti-Example: Data Property Mistaken for State

### Incorrect Extraction

- **Entity:** Order
- **State:** created on 2026-01-15

### Source Text Reference

"The system records the order creation date for reporting purposes."

### Explanation

- A creation date is a data value, not a lifecycle condition.
- Dates are not finite lifecycle states.
- The information is better represented as a data property when relevant.
---

## Anti-Example: Missing Critical State

### Incorrect Extraction

- **Entity:** Order
- **States:**
  - created
  - paid
  - shipped

### Correct Extraction

- **Entity:** Order
- **States:**
  - created
  - paid
  - shipped
  - delivered
  - cancelled

### Explanation

The extraction is incomplete because:
- The process explicitly allows orders to be delivered.
- The process explicitly allows orders to be cancelled.
- Both are meaningful lifecycle conditions resulting from critical actions.

---