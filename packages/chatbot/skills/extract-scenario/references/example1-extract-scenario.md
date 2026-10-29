
# Scenario Extraction — Examples and Anti-Examples

## Source Text

"When a customer creates an order, the order is initially pending and its payment status is Pending.

The customer can confirm the order. Once the order is confirmed, the system makes the payment action available.

The customer then enters a payment amount and requests payment processing. The external payment service returns whether the payment was successful.

If the payment succeeds, the system updates the payment status to Paid and makes the ship Order action available. If the payment fails, the system updates the payment status to Failed and makes the retry Payment action available.

When the warehouse ships a paid order, the system updates the order status to Shipped and makes the confirm Delivery action pending.

The customer can also cancel a pending order. When cancellation occurs, the order status becomes Cancelled and the payment action is no longer available."

---

## Entity Definition

### Entity: Order

**Actions:**
- create Order
- confirm Order
- process Payment
- retry Payment
- ship Order
- confirm Delivery
- cancel Order

**Data Properties:**
- orderStatus: string
- paymentStatus: string

**States:**
- created
- confirmed
- paid
- shipped
- cancelled

### Action Inputs and Outputs

**process Payment**
- Inputs:
  - amount: int
- Outputs:
  - paymentSuccess: boolean

**Other actions**
- No inputs or outputs specified.

---

## Example: Valid Scenario with Data Assignment

### Correct Extraction

```text
Scenario: Successful Payment
Given:
    the Order is confirmed
    AND process Payment is enabled
When:
    process Payment is executed with inputs amount=100, outputs paymentSuccess=true
Then:
    the Order's paymentStatus is set to "Paid"
    AND ship Order is available.
```

### Explanation

This scenario is valid because:
- Given describes the situation before payment.
- When contains exactly one action execution.
- The payment amount is provided as an external input.
- The payment result is returned as an output.
- Then describes the resulting data assignment and action availability.

---

## Example 2: Valid Scenario with Guard

### Correct Extraction

```text
Scenario: Failed Payment
Given:
    the Order is confirmed
    AND process Payment is enabled
When:
    process Payment is executed with inputs amount, outputs paymentSuccess
    AND paymentSuccess equal to false
Then:
    the Order's paymentStatus is set to "Failed"
    AND retry Payment is available.
```

### Explanation

This scenario is valid because:
- When contains exactly one action execution.
- The paymentSuccess assertion constrains the output.
- The assertion acts as a guard on the payment activity.
- Then describes the consequences of a failed payment.

---

## Example 3: Valid Scenario with Pendingness

### Correct Extraction

```text
Scenario: Ship Paid Order
Given:
    the Order is paid
    AND ship Order is enabled
    AND confirm Delivery is not pending
When:
    ship Order is executed
Then:
    the Order's orderStatus is set to "Shipped"
    AND confirm Delivery is pending.
```

### Explanation

This scenario is valid because:
- Given checks the Order state, enabledness, and pendingness.
- When contains one action execution.
- Then assigns the new order status.
- Then creates a pending obligation to confirm delivery.

---

## Anti-Example: Multiple Actions in When

### Incorrect Extraction

```text
Scenario: Confirm and Pay Order
Given:
    the Order is created
When:
    confirm Order is executed
    AND process Payment is executed
Then:
    the Order's paymentStatus is set to "Paid".
```

**Correct approach:** Split a workflow containing multiple actions into separate scenarios.

---

## Anti-Example: Incorrect Condition in Given

### Incorrect Extraction

```text
Scenario: Successful Payment
Given:
    the Order's paymentStatus is set to "Paid"
When:
    process Payment is executed with inputs amount=100, outputs paymentSuccess=true
Then:
    ship Order is available.
```

### Explanation

- The successful payment result belongs in Then, not Given.
---

## Anti-Example: Invalid Consequence in Then

### Incorrect Extraction

```text
Scenario: Successful Payment
Given:
    the Order is confirmed
When:
    process Payment is executed with inputs amount=100, outputs paymentSuccess=true
Then:
    ship Order is enabled
    AND the Order is paid.
```

### Explanation

Then must describe permitted consequences.

- "ship Order is enabled" is an enabledness assertion, not a permitted Then consequence.
- "the Order is paid" is a state assertion, not a permitted Then consequence.

---

## Anti-Example: Incorrect Input and Output

### Incorrect Extraction

```text
Scenario: Successful Payment
Given:
    the Order is confirmed
When:
    process Payment is executed with inputs paymentSuccess=true, outputs amount=100
Then:
    the Order's paymentStatus is set to "Paid".
```

### Explanation

The incorrect extraction reverses the input and output.

- amount is provided externally when payment is requested.
- paymentSuccess is returned by the external payment service.
- Action inputs and outputs must match the action specification.

**Correct approach:** Preserve the correct input and output definitions and their types.

---

## Anti-Example: Invented Consequence

### Incorrect Extraction

```text
Scenario: Cancel Pending Order
Given:
    the Order is created
When:
    cancel Order is executed
Then:
    the Order's orderStatus is set to "Cancelled"
    AND confirm Delivery is pending.
```

### Explanation

Do not invent consequences that are not supported by the source text.

- Cancellation updates the order status.
- Cancellation makes payment unavailable.
- The source text does not state that cancellation requires delivery confirmation.

---


## Anti-Example: Contradictory Availability in Given

### Incorrect Extraction

```text
Scenario: Successful Payment
Given:
    the Order is confirmed
    AND process Payment is available
    AND process Payment is not available
When:
    process Payment is executed with inputs amount=100, outputs paymentSuccess=true
Then:
    the Order's paymentStatus is set to "Paid".
```

### Explanation

The Given conditions are contradictory because:
- process Payment cannot be both available and not available at the same moment.
- The preconditions describe an impossible DCR marking.

---

## Anti-Example: Contradictory Data Assertions Between Given and When

### Incorrect Extraction

```text
Scenario: Process Pending Payment
Given:
    the Order's paymentStatus equal to "Pending"
When:
    process Payment is executed with inputs amount
    AND the Order's paymentStatus equal to "Paid"
Then:
    the Order's paymentStatus is set to "Paid".
```

### Explanation

The scenario is inconsistent because:
- Given requires paymentStatus to be "Pending".
- The guard in When requires the same property to be "Paid".
- Both assertions refer to the same pre-execution data value.
- The two conditions cannot be satisfied simultaneously.


---

## Anti-Example: Contradictory Data Assignments in Then

### Incorrect Extraction

```text
Scenario: Successful Payment
Given:
    the Order is confirmed
When:
    process Payment is executed with inputs amount=100, outputs paymentSuccess=true
Then:
    the Order's paymentStatus is set to "Paid"
    AND the Order's paymentStatus is set to "Failed".
```

### Explanation

The Then consequences are contradictory because:
- The same data property is assigned two different values.
- paymentStatus cannot simultaneously be "Paid" and "Failed" after the same action execution.

---

## Anti-Example: Contradictory Action Consequences in Then

### Incorrect Extraction

```text
Scenario: Successful Payment
Given:
    the Order is confirmed
When:
    process Payment is executed with inputs amount=100, outputs paymentSuccess=true
Then:
    ship Order is available
    AND ship Order is not available.
```

### Explanation

The Then consequences are inconsistent because:
- The same action cannot become both available and not available.
- These consequences describe contradictory DCR inclusion states.

