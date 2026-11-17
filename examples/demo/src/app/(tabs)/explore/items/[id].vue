<script setup lang="ts">
import { computed, LayoutAnimation, StyleSheet, watch, type Style } from 'vue'
import { Link, Stack, useLocalSearchParams, useRouter } from 'vuenative/router'
import FieldRow from '../../../../components/FieldRow.vue'
import Page from '../../../../components/Page.vue'
import Section from '../../../../components/Section.vue'
import { findItem, items, removeItem } from '../../../../store'
import { colors } from '../../../../theme'

const router = useRouter()
const { id } = useLocalSearchParams<{ id: string }>()
const item = computed(() => findItem(id))
const nextItem = computed(() => item.value && items.value[items.value.indexOf(item.value) + 1])

// The badge springs into its new look (size, color, tilt) when the item is marked done.
watch(
  () => item.value?.done,
  () => LayoutAnimation.configureNext(LayoutAnimation.Presets.spring),
)

const styles = StyleSheet.create({
  title: { fontSize: 34, fontWeight: '800', color: colors.text },
  badgeText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  link: { fontSize: 17, color: colors.green },
  empty: { fontSize: 17, color: colors.secondaryText },
})

function badgeStyle(done: boolean): Style {
  return {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: done ? colors.green : colors.tertiaryText,
    transform: [{ scale: done ? 1.15 : 1 }, { rotate: done ? '-4deg' : '0deg' }],
  }
}

function deleteItem() {
  if (item.value) removeItem(item.value)
  router.back()
}
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: item?.text ?? 'Item', headerBackTitle: 'Lists' }" />

    <template v-if="item">
      <Text :style="styles.title">{{ item.text }}</Text>

      <View :style="badgeStyle(item.done)">
        <Text :style="styles.badgeText">{{ item.done ? 'Done!' : 'To do' }}</Text>
      </View>

      <Section>
        <FieldRow label="Done" detail="Animated with LayoutAnimation">
          <Switch v-model="item.done" />
        </FieldRow>
      </Section>

      <Section v-if="nextItem">
        <Link :href="`/explore/items/${nextItem.id}`" push>
          <Text :style="styles.link">Next: {{ nextItem.text }} ›</Text>
        </Link>
      </Section>

      <Button title="Delete item" :style="{ color: colors.red }" @press="deleteItem" />
    </template>

    <Text v-else :style="styles.empty">This item no longer exists.</Text>
  </Page>
</template>
