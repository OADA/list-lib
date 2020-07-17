# OADA/list-lib

A library for handling items in OADA lists.

For detailed options, see the `Options` type in [this file](src/index.ts).

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
```
