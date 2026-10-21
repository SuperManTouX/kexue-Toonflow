<template>
  <el-dialog v-model="visible" title="登录 SXWZ 算力" width="min(420px, calc(100vw - 32px))" alignCenter appendToBody destroyOnClose :closeOnClickModal="!submitting" :closeOnPressEscape="!submitting" :showClose="!submitting" @open="loadCaptcha" @closed="resetForm">
    <el-form labelPosition="top" @submit.prevent="submit">
      <el-form-item label="账号">
        <el-input v-model="username" autocomplete="username" :disabled="submitting" />
      </el-form-item>
      <el-form-item label="密码">
        <el-input v-model="password" type="password" showPassword autocomplete="current-password" :disabled="submitting" @keyup.enter="submit" />
      </el-form-item>
      <el-form-item label="验证码">
        <div class="captchaRow">
          <el-input v-model="captchaValue" autocomplete="off" :disabled="submitting || captchaLoading" @keyup.enter="submit" />
          <button class="captchaImageButton" type="button" aria-label="刷新验证码" :disabled="submitting || captchaLoading" @click="loadCaptcha">
            <img v-if="captchaImageSrc" :src="captchaImageSrc" alt="图形验证码，点击刷新" />
            <span v-else>{{ captchaLoading ? "加载中" : "刷新验证码" }}</span>
          </button>
        </div>
      </el-form-item>
      <div class="dialogActions">
        <el-button :disabled="submitting" @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" :disabled="!username.trim() || !password || !captchaId || !captchaValue.trim() || !captchaImageSrc || captchaLoading" @click="submit">登录</el-button>
      </div>
    </el-form>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import { loadSuanliCaptcha, loginSuanli } from "@/stores/suanli";

const visible = defineModel<boolean>("visible", { default: false });
const username = ref("");
const password = ref("");
const captchaId = ref("");
const captchaValue = ref("");
const captchaImageSrc = ref("");
const submitting = ref(false);
const captchaLoading = ref(false);
let captchaRequestRevision = 0;

function toCaptchaImageSrc(image: string) {
  if (/^data:image\/(?:png|jpe?g|gif|webp);base64,/i.test(image)) return image;
  if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image)) return `data:image/png;base64,${image}`;
  throw new Error("SXWZ 验证码图片格式无效");
}

function resetForm() {
  captchaRequestRevision++;
  username.value = "";
  password.value = "";
  captchaId.value = "";
  captchaValue.value = "";
  captchaImageSrc.value = "";
  captchaLoading.value = false;
}

async function loadCaptcha() {
  const revision = ++captchaRequestRevision;
  captchaId.value = "";
  captchaValue.value = "";
  captchaImageSrc.value = "";
  captchaLoading.value = true;
  try {
    const captcha = await loadSuanliCaptcha();
    if (revision !== captchaRequestRevision) return;
    const imageSrc = toCaptchaImageSrc(captcha.captchaImage);
    captchaId.value = captcha.captchaId;
    captchaImageSrc.value = imageSrc;
  } catch (error) {
    if (revision === captchaRequestRevision) ElMessage.error(error instanceof Error ? error.message : "获取 SXWZ 验证码失败");
  } finally {
    if (revision === captchaRequestRevision) captchaLoading.value = false;
  }
}

async function submit() {
  if (submitting.value || captchaLoading.value || !username.value.trim() || !password.value || !captchaId.value || !captchaValue.value.trim()) return;
  submitting.value = true;
  try {
    await loginSuanli(username.value.trim(), password.value, captchaId.value, captchaValue.value.trim());
    password.value = "";
    captchaValue.value = "";
    ElMessage.success("SXWZ 算力登录成功");
    visible.value = false;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "SXWZ 登录失败");
    void loadCaptcha();
  } finally {
    submitting.value = false;
  }
}
</script>

<style lang="scss" scoped>
.captchaRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 8px;
  align-items: center;

  .captchaImageButton {
    display: flex;
    width: 112px;
    height: 40px;
    align-items: center;
    justify-content: center;
    padding: 0 6px;
    overflow: hidden;
    border: 1px solid var(--el-border-color);
    border-radius: 4px;
    background: var(--el-fill-color-blank);
    color: var(--el-text-color-secondary);
    cursor: pointer;

    &:disabled {
      cursor: not-allowed;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  }
}

.dialogActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
