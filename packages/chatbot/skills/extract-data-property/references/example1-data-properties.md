# Example1: data properties


## Source text (Amazon Commerce)
When a customer places an order, the system records the order ID, total amount, and payment status. The total amount varies depending on the products purchased. The payment status can be Pending, Paid, or Failed.
For different payment amount, several discount can be applied ... If the customer refunds ...

Every customer order has a fixed shipping fee of 10 EUR. This fee is the same for all orders and never changes. Each order is associated with a customer.

The warehouse system validates the available quantity of each product before approving an order. Every product has a color.


## Data Properties

### Extracted Data Properties
| Property Name | Entity Name | Type |
|---|---|---|
| Order ID | Order | string |
| Total Amount | Order | int |
| Payment Status | Order | string |

### Incorrect Extraction

| Property Name | Entity Name | Type |
|---|---|---|
| Shipping Fee | Order | int |
| Customer | Order | Customer |
| Product Color | Product | string |


## Why
* Order Id, total amount and payment is critical in the domain, as they are used to distinguish different order, total amount & payment status, which there are business related rules that require those data to be persistent
* Shipping fee is a constant in the domain, it's incorrect extraction
* Customer - Order is a relation
* Product color is not critical property involved with any business rule or scenario, skip it.