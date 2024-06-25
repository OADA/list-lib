# @oada/list-lib

[![npm](https://img.shields.io/npm/v/@oada/list-lib)](https://www.npmjs.com/package/@oada/list-lib)
[![Downloads/week](https://img.shields.io/npm/dw/@oada/list-lib.svg)](https://npmjs.org/package/@oada/list-lib)
[![code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![License](https://img.shields.io/github/license/OADA/client)](LICENSE)

A library for handling lists of items in OADA for TypeScript and JavaScript.
The library takes callbacks for events like
new items, removed items, and changed items.
It tried to abstract away as much of the complexity as is reasonable,
and tracks which items in the list are new, old, etc.

For detailed options, see the `Options` type in src/Options.ts

## Basic Usage Example

```typescript
import { ChangeType, ListWatch, AssumeState } from '@oada/list-lib'

// See type definitions for all supported options
const watch = new ListWatch({
    path: '/bookmarks/foo/list',
    assertItem: /* assertion function to run on each item handled */,
    conn: /* an @oada/client instance */,
    name: /* string; key name of the oada-list-lib entry in the _meta doc*/,
    resume: /* boolean; whether to track changes using a _meta/oada-list-lib/<name> entry */,
    onNewList: /* AssumeState.New || AssumeState.Handled; Whether or not to handle existing
                  list items on startup. `New` means it will treat the list as new every time
                  it starts up and will attempt to process each item; `Handled` means it will
                  not process existing items. */,
})

// Uses async generators
const itemsGenerator = await watch.on(ChangeType.ItemAdded);
for await (const item of itemsGenerator) {
    console.log(item, 'New item added');
}

// Can use callbacks instead
watch.on(ChangeType.ItemAdded, ({ item, id }) => { console.log(item, 'New list item') });
watch.on(ChangeType.ItemRemoved, ({ id }) => { console.log(item, 'Item removed') },
```

## Item types

While the `ListWatch` class is generic,
you will typically not want to specify a type parameter in your code.
If you supply an `assertItem` function,
the type of `Item` will be inferred from it.
This will help minimize runtime errors
(assuming your type assertion is good),
and in the case of no assertion, the library defaults `Item` to `unknown`.

## Rechecking items

In more advanced use cases, you might want to prompt the library to re-check
all the items in the list.
For this reason, `ListWatch` has a `forceRecheck` method.
Calling this will cause the library to check all the current list items.
