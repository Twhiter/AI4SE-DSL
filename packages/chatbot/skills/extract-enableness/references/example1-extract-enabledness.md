
# Action Enabledness — Examples and Anti-Examples

## Source Text

When a customer places an order, the system will validate the payment before the order can be shipped. If the customer uses coupons, it's not necessary to check the payment, it can be shipped directly.

If a fraud review is required, the shipping is not possible until the reviewing is completed. However, if no fraud review is required, the order can proceed without it.

After the order is shipped, the customer can confirm delivery.

Each Order has its own lifecycle, including validate Payment, review Fraud, ship Order, and confirm Delivery.

The system also has a global generate Daily Report action, which does not belong to any entity lifecycle."

---

## Example 1: Valid Condition

### Source Text Reference
"The system must validate the payment before the order can be shipped."

### Correct Extraction
**`<validate Payment, condition, ship Order>`** 

### Explanation
This is a valid condition because:
- Shipping depends on payment validation.
- If validate Payment is included, it must have been executed.
- If validate Payment is not relevant/included (e.g., use coupon), the condition does not block shipping.

---

## Example 2: Valid Milestone

### Source Text Reference
"If a fraud review is required, the review must be completed before shipping. However, if no fraud review is required, the order can proceed without it."

### Correct Extraction
**`<review Fraud, milestone, ship Order>`** 

### Explanation
This is a valid milestone because:
- A pending fraud review blocks shipping.
- If the fraud review is not pending, it does not block shipping.
- If the fraud review is not included, it does not block shipping.

---

## Anti-Example: Confusing Condition and Milestone

### Source Text Reference
"If a fraud review is required, the review must be completed before shipping. However, if no fraud review is required, the order can proceed without it."

### Incorrect Extraction

```text
Action ship Order is enabled means {
    review Fraud was executed or is not available
}
```

### Correct Extraction

```text
Action ship Order is enabled means {
    review Fraud is not pending or is not available
}
```

### Explanation
Do not use a condition when the requirement is specifically about pending work.

- A condition checks whether an action was executed.
- A milestone checks whether an action is not pending.
- A fraud review that is included but not pending does not block shipping, even if it was never executed.
- A fraud review is claimed as required (pending action)

---

## Anti-Example: Unreachable Action

### Source Text Reference
"Each Order has its own lifecycle, including validate Payment, review Fraud, ship Order, and confirm Delivery. The system also has a global generate Daily Report action."

### Incorrect Extraction

```text
Action generate Daily Report is enabled means {
    ship Order was executed or is not available
}
```

### Explanation
This extraction is invalid because:
- generate Daily Report belongs to no entity lifecycle.
- ship Order belongs to the Order entity lifecycle.
- An action without an entity lifecycle cannot reference an entity-specific action in its enabled specification.

---

## Anti-Example: Cross-Entity Lifecycle Reference

### Source Text Reference
"After the order is shipped, the customer can confirm delivery."

Assume:
- ship Order belongs to the Order entity lifecycle.
- confirm Delivery belongs to a separate Delivery entity lifecycle.

### Incorrect Extraction

```text
Action confirm Delivery is enabled means {
    ship Order was executed or is not available
}
```

### Explanation
This extraction is invalid because:
- The two actions belong to different entity lifecycles.
- An entity lifecycle action cannot directly reference actions from another entity lifecycle.

---