# Printer: entities & roles


## Source text
The operator starts by submitting a job file. The printer adds a job file to the print queue called scheduled jobs. At the time the job file is added to the scheduled jobs the printer starts printing. If the operator does nothing, the printer continues and eventually completes printing ......

## Entities & Roles
```
Entity Printer {
    Data properties: 
        scheduled jobs: a queue
    Actions:
        start printing,
        complete printing
}

Role Operator.
```

## Why
- In the text, it mentions the Printer, since the Printer has specific data to persist, it also has actions, to identify which printer start printing and complete printing, it's appropriate to model it as an entity.
- For Operator, it's a human role, and doesn't need it to distinguish which operator instances interacts with the Printer, therefore, considering it as a whole, it's built as a role.
- For job file, it's more as a primitive type, and printer's data properties can cover it. Therefore, it's not built.