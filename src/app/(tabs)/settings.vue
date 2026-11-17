<script setup>
import { Keyboard, ref } from 'vue'
import { Link } from 'vuenative/router'
import { hideDoneItems, items, removeLastItem } from '../../store.js'

const aboutVisible = ref(false)

const styles = {
  screen: { flex: 1, padding: 24, gap: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 17 },
  removeButton: { color: '#ff3b30', fontSize: 17 },
  link: { fontSize: 17, color: '#42b883', textAlign: 'center' },
  about: { flex: 1, padding: 24, gap: 16 },
  aboutHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  aboutTitle: { fontSize: 22, fontWeight: 'bold' },
}

function removeLast() {
  removeLastItem()
  Keyboard.dismiss()
}
</script>

<template>
  <View :style="styles.screen">
    <View :style="styles.row">
      <Text :style="styles.label">Ocultar concluídos</Text>
      <Switch v-model="hideDoneItems" />
    </View>

    <Button title="Remover último" :style="styles.removeButton" @press="removeLast" />
    <Button title="Sobre" @press="aboutVisible = true" />
    <Link href="/about">
      <Text :style="styles.link">Abrir rota modal ›</Text>
    </Link>

    <Modal
      :visible="aboutVisible"
      animation-type="slide"
      presentation-style="pageSheet"
      @request-close="aboutVisible = false"
    >
      <View :style="styles.about">
        <View :style="styles.aboutHeader">
          <Text :style="styles.aboutTitle">Sobre</Text>
          <Button title="Fechar" @press="aboutVisible = false" />
        </View>
        <Text>Vue Native: Vue renderizando views nativas do iOS. {{ items.length }} itens.</Text>
      </View>
    </Modal>
  </View>
</template>
