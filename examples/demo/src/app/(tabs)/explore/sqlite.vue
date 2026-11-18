<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Stack } from '@nativue/core/router'
import { CheckIcon } from '@nativue/icons/lucide'
import { SQLite } from '@nativue/sqlite'
import FieldRow from '@/components/FieldRow.vue'
import Page from '@/components/Page.vue'
import Section from '@/components/Section.vue'
import { colors } from '@/lib/theme'

interface Todo {
  id: number
  title: string
  done: number
}

interface Counts {
  total: number
  done: number
}

const database = SQLite.open('demo.db')
const tableCreated = database.execute(
  'CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)',
)

const todos = ref<Todo[]>([])
const counts = ref<Counts>({ total: 0, done: 0 })
const newTitle = ref('')

async function load() {
  await tableCreated

  todos.value = await database.all<Todo>('SELECT id, title, done FROM todos ORDER BY id')
  counts.value = (await database.get<Counts>(
    'SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS done FROM todos',
  ))!
}

async function addTodo() {
  const title = newTitle.value.trim()
  if (!title) return

  newTitle.value = ''
  await database.run('INSERT INTO todos (title) VALUES ($title)', { title })
  await load()
}

async function toggle(todo: Todo) {
  await database.run('UPDATE todos SET done = NOT done WHERE id = ?', [todo.id])
  await load()
}

async function clearDone() {
  await database.run('DELETE FROM todos WHERE done = 1')
  await load()
}

onMounted(load)
</script>

<template>
  <Page>
    <Stack.Screen :options="{ title: 'SQLite' }" />

    <Section
      title="Todos"
      footer="@nativue/sqlite keeps them in a database on the device: relaunch the app and they're still here."
    >
      <View class="flex-row gap-2">
        <TextInput
          v-model="newTitle"
          placeholder="New todo"
          class="h-11 flex-1 rounded-xl border-2 border-slate-200 px-3 focus:border-brand dark:border-slate-700 dark:focus:border-brand"
          @submit-editing="addTodo"
        />
        <Pressable
          class="h-11 items-center justify-center rounded-xl bg-brand px-4 active:opacity-70"
          @press="addTodo"
        >
          <Text class="font-semibold text-white">Add</Text>
        </Pressable>
      </View>

      <Pressable
        v-for="todo in todos"
        :key="todo.id"
        class="flex-row items-center gap-3 rounded-xl bg-white px-3 py-3 active:bg-slate-200 dark:bg-slate-800 dark:active:bg-slate-700"
        @press="toggle(todo)"
      >
        <View
          :class="[
            'h-6 w-6 items-center justify-center rounded-full border-2',
            todo.done ? 'border-brand bg-brand' : 'border-slate-300 dark:border-slate-600',
          ]"
        >
          <CheckIcon v-if="todo.done" :size="14" color="#ffffff" :stroke-width="3" />
        </View>
        <Text
          :class="[
            'flex-1 text-base',
            todo.done ? 'text-slate-400 line-through' : 'text-slate-900 dark:text-white',
          ]"
        >
          {{ todo.title }}
        </Text>
      </Pressable>

      <Text v-if="todos.length === 0" class="text-slate-500">Nothing yet: add one above.</Text>
    </Section>

    <Section title="Queries" footer="Counted by SQL: COUNT and SUM over the table.">
      <FieldRow label="Todos" detail="SELECT COUNT(*)">
        <Text :style="{ fontSize: 17, fontWeight: '700', color: colors.teal }">
          {{ counts.total }}
        </Text>
      </FieldRow>
      <FieldRow label="Done" detail="SUM(done)">
        <Text :style="{ fontSize: 17, fontWeight: '700', color: colors.green }">
          {{ counts.done }}
        </Text>
      </FieldRow>
      <Button title="Delete done todos" :disabled="counts.done === 0" @press="clearDone" />
    </Section>
  </Page>
</template>
