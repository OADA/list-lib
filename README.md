# OADA/list-lib

A library for handling lists of items in OADA for TypeScript and JavaScript.
The library takes callbacks for events like
new items, removed items, and changed items.
It tried to abstract away as much of the complexity as is reasonable,
and tracks which items in the list are new, old, etc.

For detailed options, see the `Options` type in src/Options.ts

## Basic Usage Example

```typescript
import { ListWatch } from '@oada/list-lib'

// See type definitions for all supported options
const watch = new ListWatch({
    path: '/bookmarks/foo/list',
    name: 'bob',
    conn: /* an @oada/client instance */,
    resume: true,

    onAddItem(item, id) { console.log(`New list item ${id}: %O`, item) },
    onRemoveItem(id) { console.log(`Item ${id} removed`) },
})

// The watch can be stopped after creation
await watch.stop()
```

## Item types

While the `ListWatch` class is generic,
you will typically not want to specify a type paramter in your code.
If you supply an `assertItem` function,
the type of `Item` will be inferred from it.
This will help minimize runtime errors
(assuming your type assertion is good),
and in the case of no assertion the library defaults `Item` to `unknown`.

## Rechecking items

In more advanced use-cases, you might want to prompt the libray to re-check
all the items in the list.
For this reason, `ListWatch` has a `forceRecheck` method.
Calling this will cause the library to check all the current list items.
