# Switch

The platform's on/off toggle. Bind it with `v-model`:

```vue
<Switch v-model="notifications" />
```

## Props

| Prop      | Type      | Description                                                      |
| --------- | --------- | ---------------------------------------------------------------- |
| `v-model` | `boolean` | whether it's on, kept in sync both ways                          |
| `value`   | `boolean` | whether it's on, without `v-model`: pair it with `@value-change` |

## Events

| Event           | Payload   | Fires                  |
| --------------- | --------- | ---------------------- |
| `@value-change` | `boolean` | when the user flips it |
