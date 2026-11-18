# ActivityIndicator

The platform's spinner, for something loading.

```vue
<ActivityIndicator v-if="loading" size="large" color="#0e9f84" />
```

## Props

| Prop        | Type                 | Default      | Description                 |
| ----------- | -------------------- | ------------ | --------------------------- |
| `animating` | `boolean`            | `true`       | spins; hidden while `false` |
| `size`      | `'small' \| 'large'` | `'small'`    |                             |
| `color`     | `string`             | the system's |                             |
| `style`     | `Style`              |              |                             |
