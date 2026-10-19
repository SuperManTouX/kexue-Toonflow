<template>
  <section class="suanliParamsForm" aria-label="算力模型参数">
    <div v-if="loadingTemplate" class="formStatus" role="status">正在读取模型参数…</div>
    <div v-else-if="templateError" class="formError" role="alert">{{ templateError }}</div>
    <div v-else-if="!params.length" class="formError" role="alert">该模型没有可用的请求模板。</div>
    <el-form v-else class="taskFields" labelPosition="top">
      <template v-for="field in params" :key="field.name">
        <el-form-item v-if="field.ui !== 'hidden'" :label="field.label" :required="field.required" :error="fieldErrors[field.name]">
          <el-input v-if="field.ui === 'textarea'" :modelValue="stringValue(field)" type="textarea" :rows="3" :maxlength="20000" showWordLimit :disabled="disabled" @update:modelValue="setFieldValue(field.name, $event)" />
          <el-select v-else-if="field.ui === 'proportion' || field.ui === 'resolution' || field.ui === 'select' || field.ui === 'quantity'" :modelValue="optionValue(field)" :disabled="disabled" class="fieldControl" @update:modelValue="setFieldValue(field.name, $event)">
            <el-option v-for="option in field.options" :key="String(option)" :label="String(option)" :value="option" />
          </el-select>
          <div v-else-if="field.ui === 'dimension'" class="dimensionControl">
            <el-input-number :modelValue="getDimensionPart(field, 'width')" :min="field.dimension.width?.min ?? 1" :max="field.dimension.width?.max" :disabled="disabled" controlsPosition="right" aria-label="宽度" @update:modelValue="setDimensionPart(field, 'width', $event)" />
            <span aria-hidden="true">{{ field.dimension.separator }}</span>
            <el-input-number :modelValue="getDimensionPart(field, 'height')" :min="field.dimension.height?.min ?? 1" :max="field.dimension.height?.max" :disabled="disabled" controlsPosition="right" aria-label="高度" @update:modelValue="setDimensionPart(field, 'height', $event)" />
          </div>
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
      <p v-if="requiredImageUploadUnavailable" class="formError" role="alert">该模型要求上传图片。配置服务端 OSS 图片上传后才能生成。</p>
    </el-form>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { ElButton, ElForm, ElFormItem, ElImage, ElInput, ElInputNumber, ElOption, ElSelect } from "element-plus";
import { useNodeAi, type NodeSuanliParam } from "@toonflow/nodes-scaffold/nodeAi";

const props = defineProps<{ modelRef: string; modelValue?: { modelRef: string; values: Record<string, unknown> }; disabled?: boolean; referenceText?: string }>();
const emit = defineEmits<{ "update:modelValue": [value: { modelRef: string; values: Record<string, unknown> }] }>();
const ai = useNodeAi();
const params = ref<NodeSuanliParam[]>([]);
const values = reactive<Record<string, unknown>>({});
const fieldErrors = ref<Record<string, string>>({});
const loadingTemplate = ref(false);
const templateError = ref("");
const imageUploadAvailable = ref(false);
const uploadingField = ref("");
let loadController: AbortController | undefined;
let uploadController: AbortController | undefined;
const requiredImageUploadUnavailable = computed(() => !imageUploadAvailable.value
  && params.value.some(field => field.ui === "imageUpload" && field.required));

function initializeValues(fields: NodeSuanliParam[]) {
  for (const key of Object.keys(values)) delete values[key];
  const restored = props.modelValue?.modelRef === props.modelRef ? props.modelValue.values : {};
  for (const field of fields) {
    if (Object.hasOwn(restored, field.name)) values[field.name] = structuredClone(restored[field.name]);
    else if (field.default !== undefined) values[field.name] = structuredClone(field.default);
  }
  fieldErrors.value = {};
  emitValues();
}

function emitValues() {
  emit("update:modelValue", { modelRef: props.modelRef, values: structuredClone(values) });
}

async function loadTemplate(modelRef: string, signal: AbortSignal) {
  loadingTemplate.value = true;
  templateError.value = "";
  try {
    const config = await ai.getSuanliModelConfig(modelRef, signal);
    params.value = config.params;
    imageUploadAvailable.value = config.imageUploadAvailable;
    initializeValues(config.params);
  } catch (error) {
    if (!signal.aborted) templateError.value = error instanceof Error ? error.message : "无法读取模型参数";
  } finally {
    if (!signal.aborted) loadingTemplate.value = false;
  }
}

function imageValues(field: Extract<NodeSuanliParam, { ui: "imageUpload" }>) {
  const value = values[field.name];
  return Array.isArray(value) ? value.filter((url): url is string => typeof url === "string") : [];
}

function stringValue(field: Extract<NodeSuanliParam, { ui: "textarea" }>) {
  return typeof values[field.name] === "string" ? values[field.name] as string : "";
}

function optionValue(field: Extract<NodeSuanliParam, { ui: "proportion" | "resolution" | "select" | "quantity" }>) {
  const value = values[field.name];
  return typeof value === "string" || typeof value === "number" ? value : "";
}

function setFieldValue(name: string, value: unknown) {
  values[name] = value;
  fieldErrors.value[name] = "";
  emitValues();
}

function getDimensionPart(field: Extract<NodeSuanliParam, { ui: "dimension" }>, part: "width" | "height") {
  const current = typeof values[field.name] === "string" ? values[field.name] as string : "";
  const value = current.split(field.dimension.separator)[part === "width" ? 0 : 1];
  return value && /^\d+$/.test(value) ? Number(value) : 1;
}

function setDimensionPart(field: Extract<NodeSuanliParam, { ui: "dimension" }>, part: "width" | "height", value: number | undefined) {
  const width = part === "width" ? value : getDimensionPart(field, "width");
  const height = part === "height" ? value : getDimensionPart(field, "height");
  setFieldValue(field.name, width === undefined || height === undefined ? "" : `${width}${field.dimension.separator}${height}`);
}

async function uploadImages(field: Extract<NodeSuanliParam, { ui: "imageUpload" }>, event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = Array.from(input.files ?? []);
  input.value = "";
  if (!selected.length || props.disabled || !imageUploadAvailable.value) return;
  const remaining = field.maxCount - imageValues(field).length;
  if (remaining <= 0) return;
  const controller = new AbortController();
  uploadController = controller;
  uploadingField.value = field.name;
  try {
    for (const file of selected.slice(0, remaining)) {
      if (file.size > 20 * 1024 * 1024) throw new Error("图片不能超过 20 MB");
      const url = await ai.uploadSuanliImage(file, controller.signal);
      setFieldValue(field.name, [...imageValues(field), url]);
    }
  } catch (error) {
    if (!controller.signal.aborted) fieldErrors.value[field.name] = error instanceof Error ? error.message : "图片上传失败";
  } finally {
    if (uploadController === controller) uploadController = undefined;
    uploadingField.value = "";
  }
}

function removeImage(field: Extract<NodeSuanliParam, { ui: "imageUpload" }>, index: number) {
  setFieldValue(field.name, imageValues(field).filter((_, itemIndex) => itemIndex !== index));
}

function validateValues() {
  const errors: Record<string, string> = {};
  for (const field of params.value) {
    const value = values[field.name];
    if (field.ui === "hidden") continue;
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      if (field.required) errors[field.name] = "此项为必填项";
      continue;
    }
    if (field.ui === "textarea") {
      if (typeof value !== "string" || value.length > 20000 || (field.required && !value.trim())) errors[field.name] = "请输入有效内容";
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
    } else if (field.ui === "imageUpload") {
      if (!Array.isArray(value) || value.length > field.maxCount || value.some(url => typeof url !== "string")) errors[field.name] = "图片数量无效";
    }
  }
  fieldErrors.value = errors;
  return !Object.values(errors).some(Boolean);
}

function getValues() {
  if (loadingTemplate.value || templateError.value || !params.value.length) throw new Error(templateError.value || "正在读取模型参数");
  if (uploadingField.value) throw new Error("图片正在上传，请等待完成");
  if (requiredImageUploadUnavailable.value || !validateValues()) throw new Error("请完成模型参数后再生成");
  const result = Object.fromEntries(params.value.map(field => [field.name, values[field.name]]).filter(([, value]) => value !== undefined));
  const promptField = params.value.find((field): field is Extract<NodeSuanliParam, { ui: "textarea" }> => field.ui === "textarea" && field.name === "prompt")
    ?? params.value.find((field): field is Extract<NodeSuanliParam, { ui: "textarea" }> => field.ui === "textarea");
  const referenceText = props.referenceText?.trim();
  if (promptField && referenceText) {
    const prompt = typeof result[promptField.name] === "string" ? result[promptField.name] as string : "";
    result[promptField.name] = [prompt, referenceText].filter(Boolean).join("\n\n");
  }
  return result;
}

defineExpose({ getValues });

watch(() => props.modelRef, (modelRef, _previous, onCleanup) => {
  const controller = new AbortController();
  loadController = controller;
  onCleanup(() => {
    controller.abort();
    if (loadController === controller) loadController = undefined;
    uploadController?.abort();
  });
  void loadTemplate(modelRef, controller.signal);
}, { immediate: true });

onScopeDispose(() => {
  loadController?.abort();
  uploadController?.abort();
});
</script>

<style lang="scss">
.suanliParamsForm {
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
    .el-form-item { margin-bottom: 12px; }
    .fieldControl { width: 100%; }
    .dimensionControl { display: flex; align-items: center; gap: 8px; width: 100%; }
    .dimensionControl .el-input-number { flex: 1; min-width: 0; }
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
  }
}
</style>
