<template>
  <div class="authGate">
    <el-result icon="info" title="SXWZ 登录" :subTitle="message" />
  </div>
</template>

<script setup lang="ts">
defineProps<{ message: string }>();
</script>

<style scoped lang="scss">
.authGate {
  min-height: 100vh;
  display: grid;
  place-items: center;
}
</style>
