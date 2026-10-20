<template>
  <section class="suanliTaskForm" aria-label="算力模型参数">
    <div v-if="loadingTemplate" class="formStatus" role="status">正在读取模型参数…</div>
    <div v-else-if="templateError" class="formError" role="alert">
      <span>{{ templateError }}</span>
      <el-button text size="small" :disabled="disabled" @click="loadTemplate">重试</el-button>
    </div>
    <el-form v-else class="taskFields" labelPosition="top" @submit.prevent="submitTask">
      <template v-for="field in params" :key="field.name">
        <el-form-item v-if="field.ui !== 'hidden'" :label="field.label" :required="field.required" :error="fieldErrors[field.name]">
          <el-input v-if="field.ui === 'textarea'" :modelValue="stringValue(field)" type="textarea" :rows="3" :maxlength="field.maxLength ?? 20000" showWordLimit :disabled="disabled" @update:modelValue="setFieldValue(field.name, $event)" />
          <el-switch v-else-if="field.ui === 'switch'" :modelValue="booleanValue(field)" :disabled="disabled" :aria-label="field.label" @update:modelValue="setFieldValue(field.name, $event)" />
          <el-select v-else-if="field.ui === 'proportion' || field.ui === 'resolution' || field.ui === 'select' || field.ui === 'quantity'" :modelValue="optionValue(field)" :disabled="disabled" class="fieldControl" @update:modelValue="setFieldValue(field.name, $event)">
            <el-option v-for="option in field.options" :key="String(option)" :label="String(option)" :value="option" />
          </el-select>
          <div v-else-if="field.ui === 'dimension'" class="dimensionControl">
            <el-input-number :modelValue="getDimensionPart(field, 'width')" :min="field.dimension.width?.min ?? 1" :max="field.dimension.width?.max" :disabled="disabled" controlsPosition="right" aria-label="宽度" @update:modelValue="setDimensionPart(field, 'width', $event)" />
            <span aria-hidden="true">{{ field.dimension.separator }}</span>
            <el-input-number :modelValue="getDimensionPart(field, 'height')" :min="field.dimension.height?.min ?? 1" :max="field.dimension.height?.max" :disabled="disabled" controlsPosition="right" aria-label="高度" @update:modelValue="setDimensionPart(field, 'height', $event)" />
          </div>
          <el-input-number v-else-if="field.ui === 'dimensionWidth' || field.ui === 'dimensionHeight' || field.ui === 'number'" :modelValue="numberValue(field)" :min="field.min" :max="field.max" :step="field.ui === 'number' ? field.step ?? 1 : 1" :precision="field.ui === 'number' && field.step && !Number.isInteger(field.step) ? undefined : 0" :disabled="disabled" controlsPosition="right" :aria-label="field.label" class="fieldControl" @update:modelValue="setFieldValue(field.name, $event)" />
          <div v-else-if="field.ui === 'imageUpload'" class="imageField">
            <label class="imagePicker" :class="{ disabled: disabled || !imageUploadAvailable || uploadingField === field.name }">
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" :multiple="field.maxCount > 1" :disabled="disabled || !imageUploadAvailable || uploadingField === field.name" @change="uploadImages(field, $event)" />
              <span>{{ uploadingField === field.name ? '上传中…' : '选择图片' }}</span>
            </label>
            <span class="imageCount">{{ imageValues(field).length }} / {{ field.maxCount }}</span>
            <span v-if="!imageUploadAvailable" class="imageUnavailable" role="status">服务端未配置 OSS 图片上传，无法添加图片。</span>
            <div v-if="imageValues(field).length" class="imagePreviews">
              <div v-for="(url, index) in imageValues(field)" :key="url" class="imagePreview">
                <el-image :src="url" :previewSrcList="imageValues(field)" :initialIndex="index" fit="cover" :alt="`${field.label} ${index + 1}`" />
                <el-button text circle size="small" :disabled="disabled" :aria-label="`移除第 ${index + 1} 张图片`" @click="removeImage(field, index)">×</el-button>
              </div>
            </div>
          </div>
        </el-form-item>
      </template>
      <p v-if="requiredImageUploadUnavailable" class="formError" role="alert">该模型要求上传图片。配置服务端 OSS 图片上传后才能提交。</p>
      <div class="taskSubmitRow">
        <el-button type="primary" :disabled="disabled || loadingTemplate || !!templateError || requiredImageUploadUnavailable" @click="submitTask">提交任务</el-button>
      </div>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { ElInputNumber, ElMessage, ElSwitch } from "element-plus";
import { refreshSuanliModelConfig, uploadSuanliImage } from "@/stores/suanli";
import type { SuanliModel, SuanliParam } from "@toonflow/server/suanli/types";

const props = defineProps<{ model: SuanliModel; disabled?: boolean }>();
const emit = defineEmits<{ submit: [values: Record<string, unknown>] }>();
const params = ref<SuanliParam[]>([]);
const values = reactive<Record<string, unknown>>({});
const fieldErrors = ref<Record<string, string>>({});
const loadingTemplate = ref(false);
const templateError = ref("");
const imageUploadAvailable = ref(false);
const requiredImageUploadUnavailable = computed(() => !imageUploadAvailable.value
  && params.value.some(field => field.ui === "imageUpload" && field.required));
const uploadingField = ref("");
let uploadController: AbortController | undefined;

function initializeValues(fields: SuanliParam[]) {
  for (const key of Object.keys(values)) delete values[key];
  for (const field of fields) if (field.default !== undefined) values[field.name] = structuredClone(field.default);
  fieldErrors.value = {};
}

async function loadTemplate() {
  loadingTemplate.value = true;
  templateError.value = "";
  try {
    const config = await refreshSuanliModelConfig(props.model.modelRef);
    params.value = config.params;
    imageUploadAvailable.value = config.imageUploadAvailable;
    initializeValues(config.params);
  } catch (error) {
    templateError.value = error instanceof Error ? error.message : "无法读取模型参数";
  } finally { loadingTemplate.value = false; }
}

function imageValues(field: Extract<SuanliParam, { ui: "imageUpload" }>) {
  const value = values[field.name];
  return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string") : [];
}

function stringValue(field: Extract<SuanliParam, { ui: "textarea" }>) {
  return typeof values[field.name] === "string" ? values[field.name] as string : "";
}

function booleanValue(field: Extract<SuanliParam, { ui: "switch" }>) {
  return typeof values[field.name] === "boolean" ? values[field.name] as boolean : false;
}

function optionValue(field: Extract<SuanliParam, { ui: "proportion" | "resolution" | "select" | "quantity" }>) {
  const value = values[field.name];
  return typeof value === "string" || typeof value === "number" ? value : "";
}

function numberValue(field: Extract<SuanliParam, { ui: "dimensionWidth" | "dimensionHeight" | "number" }>) {
  return typeof values[field.name] === "number" ? values[field.name] as number : undefined;
}

function setFieldValue(name: string, value: unknown) {
  values[name] = value;
  fieldErrors.value[name] = "";
}

function getDimensionPart(field: Extract<SuanliParam, { ui: "dimension" }>, part: "width" | "height") {
  const current = typeof values[field.name] === "string" ? values[field.name] as string : "";
  const index = part === "width" ? 0 : 1;
  const value = current.split(field.dimension.separator)[index];
  return value && /^\d+$/.test(value) ? Number(value) : 1;
}

function setDimensionPart(field: Extract<SuanliParam, { ui: "dimension" }>, part: "width" | "height", value: number | undefined) {
  const width = part === "width" ? value : getDimensionPart(field, "width");
  const height = part === "height" ? value : getDimensionPart(field, "height");
  values[field.name] = width === undefined || height === undefined ? "" : `${width}${field.dimension.separator}${height}`;
}

async function uploadImages(field: Extract<SuanliParam, { ui: "imageUpload" }>, event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!files.length || props.disabled || !imageUploadAvailable.value) return;
  const existing = imageValues(field);
  const remaining = field.maxCount - existing.length;
  if (remaining <= 0) return ElMessage.warning(`最多上传 ${field.maxCount} 张图片`);
  const selected = files.slice(0, remaining);
  if (files.length > remaining) ElMessage.warning(`最多还能上传 ${remaining} 张图片`);
  uploadController = new AbortController();
  uploadingField.value = field.name;
  try {
    for (const file of selected) {
      const maxSizeMB = Math.min(field.maxSizeMB ?? 20, 20);
      if (file.size > maxSizeMB * 1024 * 1024) throw new Error(`图片不能超过 ${maxSizeMB} MB`);
      const contentType = file.type.toLowerCase() === "image/jpg" ? "image/jpeg" : file.type.toLowerCase();
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(contentType)) throw new Error("仅支持 PNG、JPEG、WebP 或 GIF 图片");
      const url = await uploadSuanliImage(file, uploadController.signal, contentType);
      values[field.name] = [...imageValues(field), url];
      fieldErrors.value[field.name] = "";
    }
  } catch (error) {
    if (!uploadController.signal.aborted) ElMessage.error(error instanceof Error ? error.message : "图片上传失败");
  } finally {
    uploadController = undefined;
    uploadingField.value = "";
  }
}

function removeImage(field: Extract<SuanliParam, { ui: "imageUpload" }>, index: number) {
  values[field.name] = imageValues(field).filter((_, itemIndex) => itemIndex !== index);
}

function validateValues() {
  const errors: Record<string, string> = {};
  for (const field of params.value) {
    if (field.ui === "hidden") continue;
    const value = values[field.name];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      if (field.required) errors[field.name] = "此项为必填项";
      continue;
    }
    if (field.ui === "textarea") {
      if (typeof value !== "string" || value.length > (field.maxLength ?? 20000) || (field.required && !value.trim())) errors[field.name] = "请输入有效内容";
    } else if (field.ui === "switch") {
      if (typeof value !== "boolean") errors[field.name] = "请选择有效状态";
    } else if (field.ui === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)
        || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) errors[field.name] = "请输入有效数值";
    } else if (field.ui === "proportion" || field.ui === "resolution" || field.ui === "select" || field.ui === "quantity") {
      if (!field.options.some(option => Object.is(option, value))) errors[field.name] = "请选择有效选项";
    } else if (field.ui === "dimension") {
      const parts = typeof value === "string" ? value.split(field.dimension.separator) : [];
      const [width, height] = parts.map(Number);
      if (parts.length !== 2 || !parts.every(part => /^\d+$/.test(part)) || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || width <= 0 || height <= 0 || (field.dimension.width?.min !== undefined && width < field.dimension.width.min)
        || (field.dimension.width?.max !== undefined && width > field.dimension.width.max)
        || (field.dimension.height?.min !== undefined && height < field.dimension.height.min)
        || (field.dimension.height?.max !== undefined && height > field.dimension.height.max)) errors[field.name] = "尺寸超出允许范围";
    } else if (field.ui === "dimensionWidth" || field.ui === "dimensionHeight") {
      if (typeof value !== "number" || !Number.isSafeInteger(value)
        || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) errors[field.name] = "尺寸超出允许范围";
    } else if (field.ui === "imageUpload") {
      if (!Array.isArray(value) || value.length > field.maxCount || value.some(url => typeof url !== "string")) errors[field.name] = "图片数量无效";
    }
  }
  fieldErrors.value = errors;
  return !Object.values(errors).some(Boolean);
}

function submitTask() {
  if (props.disabled || loadingTemplate.value || templateError.value || uploadingField.value || requiredImageUploadUnavailable.value || !validateValues()) return;
  emit("submit", Object.fromEntries(params.value.map(field => [field.name, values[field.name]]).filter(([, value]) => value !== undefined)));
}

watch(() => props.model.modelId, () => { void loadTemplate(); }, { immediate: true });
onBeforeUnmount(() => uploadController?.abort());
</script>

<style lang="scss">
.suanliTaskForm {
  padding: 12px 12px 4px;

  .formStatus,
  .formError {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--el-text-color-secondary);
    font-size: 13px;
  }

  .formError { color: var(--el-color-danger); }

  .taskFields {
    .el-form-item {
      margin-bottom: 12px;
    }

    .fieldControl { width: 100%; }

    .dimensionControl {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;

      .el-input-number { flex: 1; min-width: 0; }
    }

    .imageField { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .imagePicker {
      position: relative;
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border: 1px solid var(--el-border-color);
      border-radius: var(--el-border-radius-base);
      color: var(--el-color-primary);
      cursor: pointer;

      input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
      &:focus-within { outline: 2px solid var(--el-color-primary); outline-offset: 2px; }
      &.disabled { opacity: 0.5; cursor: not-allowed; }
    }

    .imageCount { color: var(--el-text-color-secondary); font-size: 12px; }
    .imageUnavailable { color: var(--el-color-warning); font-size: 12px; }
    .imagePreviews { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; }
    .imagePreview { position: relative; width: 68px; height: 68px; }
    .imagePreview .el-image { width: 100%; height: 100%; border-radius: var(--el-border-radius-base); }
    .imagePreview .el-button { position: absolute; top: -8px; right: -8px; background: var(--el-bg-color); }

    .taskSubmitRow { display: flex; justify-content: flex-end; }
  }
}
</style>
