# Model App Listening Ports as Private Addresses

AP networking separates App Listening Ports from Public Addresses. Each AP keeps at least one App Listening Port, each App Listening Port derives one Private Address, and Public Addresses declare a target port rather than owning or strongly binding an App Listening Port.

## Considered Options

- **Keep a single Private Address.** Rejected because Public Addresses already allow different target ports, while the AP Service and Private Address model only expose one port.
- **Strongly bind Public Addresses to App Listening Port identity.** Rejected because v1 does not need editable port identity beyond the unique port number, and users should be able to remove an App Listening Port without deleting the Public Address intent.
- **Treat Public Address target ports as always implying App Listening Ports.** Rejected as a permanent invariant because users may later remove the App Listening Port and leave the Public Address blocked until the port is added back or the Public Address target changes.

## Consequences

AP Settings presents Private Addresses and Domain List as separate sections within one Settings Draft. Creating or editing a Public Address to use a new target port initially adds an App Listening Port for that port, but deleting an App Listening Port does not delete Public Addresses that target it. A Public Address whose target port has no App Listening Port remains desired but is blocked with a `target-port-missing` reason, and its routing resources should not be rendered until the target port exists again.

The Private Addresses section manages App Listening Ports using the Domain List row pattern without status icons. The Domain List and Public Addresses Panel remain public-routing surfaces; they may add App Listening Ports as part of Public Address edits, but they do not display Private Addresses.
