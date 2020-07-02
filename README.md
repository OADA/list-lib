## Usage Example

```typescript
import { ListWatch } from '@oada/list-lib'

// See type definitions for all supported options
const watch = new ListWatch({
    path: '/bookmarks/foo/list',
    conn: /* an @oada/client instance */,

    onAddItem(item, id) { console.log(`New list item ${id}: %O`, item) },
    onRemoveItem(id) { console.log(`Item ${id} removed`) },
})
```
