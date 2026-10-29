
# Action Extraction — Examples and Anti-Examples

## Source Text

When a customer wants to withdraw money, they insert their bank card into the ATM and enter their PIN. The ATM sends the PIN to an external bank authentication service, which returns a boolean result indicating whether the PIN is valid.

If authentication succeeds, the customer enters the withdrawal amount. The ATM stores the amount in the Withdrawal entity. The customer then confirms the withdrawal, and the ATM processes the stored amount."

The customer can also manage their bank card by activating or blocking it. When a card is blocked, the bank system updates its status to Blocked.

Before processing a withdrawal, the ATM displays a decorative welcome animation. The card insertion starts the authentication process."

---

## Example: Valid Action with Input

### Correct Extraction
- **Action name:** enter Withdrawal Amount
- **Initiators:** Customer
- **Observers:** ATM
- **Entity lifecycle:** Withdrawal
- **Inputs:**
  - amount: int
- **Outputs:** None

### Explanation
The withdrawal amount is provided by the customer from the external environment, so it is modeled as an action input.

---

## Example: Valid Action with Output

### Correct Extraction
- **Action name:** verify PIN
- **Initiators:** ATM
- **Observers:** Bank Authentication Service
- **Entity lifecycle:** Card
- **Inputs:** None
- **Outputs:**
  - isValid: boolean

### Explanation
The external bank authentication service returns a computed verification result, so it is modeled as an action output.

---

## Anti-Example: Broad or Hat Action

### Incorrect Extraction
- **Action name:** manage Card (should be activate Card and block Card)
- **Initiators:** Customer
- **Observers:** Bank System
- **Entity lifecycle:** Card

### Explanation
"Manage Card" is a broad and hat action. It should be replaced by the specific actions "activate Card" and "block Card".

---

## Anti-Example: Incorrect Initiator and Observer

### Incorrect Extraction
- **Action name:** insert Card
- **Initiators:** ATM (should be Customer)
- **Observers:** Customer (should be ATM)
- **Entity lifecycle:** Card

### Explanation
The customer performs the card insertion, while the ATM receives the card. Therefore, Customer is the initiator and ATM is the observer.

---

## Anti-Example: Incorrect Input Extraction

### Incorrect Extraction
- **Action name:** confirm Withdrawal
- **Initiators:** Customer
- **Observers:** ATM
- **Entity lifecycle:** Withdrawal
- **Inputs:**
  - amount: int

### Explanation
Do not create an input for `amount` because:
- The customer already provided the amount in a previous action.
- The amount is stored as a data property of the Withdrawal entity.
- Confirming the withdrawal does not require entering the amount again.

---

## Anti-Example: Missing Entity Lifecycle

### Incorrect Extraction
- **Action name:** block Card
- **Initiators:** Customer
- **Observers:** Bank System
- **Entity lifecycle:** None (should be card)

### Explanation
Blocking a card changes the state of a specific Card instance. The action must therefore be associated with the Card entity lifecycle.