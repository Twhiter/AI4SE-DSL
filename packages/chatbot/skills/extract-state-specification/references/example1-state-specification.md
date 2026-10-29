
# State Specification — Examples and Anti-Examples

## Source Text

"When a customer creates an order, the order is initially pending. The customer must confirm the order before proceeding with payment.

After the customer confirms the order, the order becomes confirmed, and the payment action is enabled.

Once payment is successful, the order becomes paid. The system stores the payment result in the Order's paymentStatus property, which can be Pending, Paid, or Failed.

The customer may request cancellation. When cancellation is requested, the system requires the cancellation request to be resolved. During this period, the order is cancellation-pending.

An order is ready for shipping when it is paid, no cancellation resolution is pending, and shipping is enabled.

After the warehouse ships the order, the order becomes shipped, and the shipping action is no longer available.

The system also maintains a Customer entity with an activate Account action."

---

## Provided Entity Definition

```text
Entity Order {
    Data properties: paymentStatus:string
    
    Actions: create Order, confirm Order, process Payment, request Cancellation, resolve Cancellation, ship Order
    
    States: created, confirmed, paid, cancellation_pending, ready_for_shipping, shipped
}

Entity Customer {
    Actions: activate Account
}
```
---

## Example 1: Execution Assertion

### Correct Extraction

```text
Declarative specification Order is confirmed means {
    confirm Order was executed
}
```

### Explanation
- The confirmed state depends on the execution of confirm Order.
- Execution assertions express whether an action has occurred.

---

## Example 2

### Correct Extraction

```text
Declarative specification Order is paid means {
    process Payment was executed
    AND its paymentStatus equal to "Paid"
}

Declarative specification Order is ready_for_shipping means {
    it is paid
    AND resolve Cancellation is not pending
    AND ship Order is enabled
}

Declarative specification Order is cancellation_pending means {
    request Cancellation was executed
    AND resolve Cancellation is pending
}

Declarative specification Order is shipped means {
    ship Order was executed
    AND ship Order is not available
}
```

---

## Anti-Example: Confusing Execution with Enabledness

### Incorrect Extraction

```text
Declarative specification Order is confirmed means {
    confirm Order is enabled
}
```

Enabled only means the action is executable now; it does not mean it was executed.

---

## Anti-Example: Confusing Pendingness with Execution

### Incorrect Extraction

```text
Declarative specification Order is cancellation_pending means {
    resolve Cancellation was not executed
}
```

### Explanation
An action that was not executed is not necessarily pending. Pendingness means an outstanding obligation exists.

---

## Anti-Example: Incorrect Cross-Entity Reference

### Incorrect Extraction

```text
Declarative specification Order is confirmed means {
    activate Account was executed
}
```

### Explanation
This specification is invalid because:
- activate Account belongs to the Customer lifecycle.
- The state confirmed belongs to the Order lifecycle.
- An Order state specification cannot directly reference an action from the Customer lifecycle.

---

## Anti-Example: Incomplete State Specification

### Incorrect Extraction

```text
Declarative specification Order is ready_for_shipping means {
    it is paid
}

Missed:
resolve Cancellation is not pending 
ship Order is enabled

```

### Explanation
The incorrect specification is incomplete because:
- Being paid is not sufficient for shipping readiness.
- Cancellation resolution must not be pending.
- The shipping action must be enabled.

**Correct approach:** Include all conditions required by the source text to characterize the state.

---
