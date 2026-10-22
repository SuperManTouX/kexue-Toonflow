<template>
  <section class="suanliParamsForm" aria-label="SXWZ 算力模型参数">
    <div v-if="loading" class="formStatus" role="status">正在读取模型参数…</div>
    <div v-else-if="loadError" class="formError" role="alert">{{ loadError }}</div>
    <template v-else>
      <el-form v-if="visibleParams.length" class="paramsForm" labelPosition="top">
        <el-form-item v-for="field in visibleParams" :key="field.name" :label="field.label" :required="field.required">
          <el-input
            v-if="field.ui === 'textarea'"
            :modelValue="stringValue(field.name)"
            type="textarea"
            :rows="3"
            :maxlength="field.maxLength ?? 20000"
            showWordLimit
            :placeholder="field.name === 'prompt' ? template?.promptPlaceholder : undefined"
            :disabled="disabled || !template?.canGenerate"
            @update:modelValue="setValue(field.name, $event)" />
          <el-input-number
            v-else-if="field.ui === 'number'"
            :modelValue="numberValue(field.name)"
            :min="field.min"
            :max="field.max"
            :disabled="disabled || !template?.canGenerate"
            controlsPosition="right"
            class="fieldControl"
            @update:modelValue="setValue(field.name, $event)" />
          <el-select
            v-else-if="field.ui === 'proportion' || field.ui === 'resolution' || field.ui === 'select' || field.ui === 'quantity'"
            :modelValue="optionValue(field.name)"
            :disabled="disabled || !template?.canGenerate"
            class="fieldControl"
            @update:modelValue="setValue(field.name, $event)">
            <el-option v-for="option in field.options" :key="String(option)" :label="String(option)" :value="option" />
          </el-select>
          <div v-else-if="field.ui === 'dimension'" class="dimensionControl">
            <el-input-number
              :modelValue="dimensionPart(field, 'width')"
              :min="field.dimension.width?.min ?? 1"
              :max="field.dimension.width?.max"
              :disabled="disabled || !template?.canGenerate"
              controlsPosition="right"
              aria-label="宽度"
              @update:modelValue="setDimensionPart(field, 'width', $event)" />
            <span class="dimensionSeparator" aria-hidden="true">{{ field.dimension.separator }}</span>
            <el-input-number
              :modelValue="dimensionPart(field, 'height')"
              :min="field.dimension.height?.min ?? 1"
              :max="field.dimension.height?.max"
              :disabled="disabled || !template?.canGenerate"
              controlsPosition="right"
              aria-label="高度"
              @update:modelValue="setDimensionPart(field, 'height', $event)" />
          </div>
          <el-switch
            v-else-if="field.ui === 'switch'"
            :modelValue="booleanValue(field.name)"
            :disabled="disabled || !template?.canGenerate"
            :aria-label="field.label"
            @update:modelValue="setValue(field.name, $event)" />
        </el-form-item>
      </el-form>
      <div v-else class="formError" role="alert">该模型没有可用的请求模板。</div>
      <div v-if="template && !template.canGenerate" class="formError" role="alert">此模型不支持纯文本输入，暂不可生成。</div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { ElForm, ElFormItem, ElInput, ElInputNumber, ElOption, ElSelect, ElSwitch } from "element-plus";
import { useNodeAi, type SuanliMediaParam, type SuanliMediaTemplate } from "@toonflow/nodes-scaffold/nodeAi";

const props = defineProps<{
  modelRef: string;
  modelValue?: { modelRef: string; values: Record<string, unknown> };
  referenceText?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: { modelRef: string; values: Record<string, unknown> }] }>();
const ai = useNodeAi();
const template = ref<SuanliMediaTemplate>();
const loading = ref(false);
const loadError = ref("");
const values = reactive<Record<string, unknown>>({});
const loadController = ref<AbortController>();
const visibleParams = computed(() => template.value?.params.filter(field => field.ui !== "hidden" && field.ui !== "imageUpload" && isVisible(field)) ?? []);

function copyValues(source: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
}

function initialize(config: SuanliMediaTemplate) {
  for (const name of Object.keys(values)) delete values[name];
  const restored = props.modelValue?.modelRef === props.modelRef ? props.modelValue.values : {};
  for (const field of config.params) {
    if (field.ui === "hidden" || field.ui === "imageUpload") continue;
    if (Object.hasOwn(restored, field.name)) values[field.name] = copyValues({ value: restored[field.name] }).value;
    else if (field.default !== undefined) values[field.name] = copyValues({ value: field.default }).value;
  }
  emitValues();
}

function emitValues() {
  emit("update:modelValue", { modelRef: props.modelRef, values: copyValues(values) });
}

function stringValue(name: string) {
  return typeof values[name] === "string" ? values[name] as string : "";
}

function optionValue(name: string) {
  const value = values[name];
  return typeof value === "string" || typeof value === "number" ? value : "";
}

function booleanValue(name: string) {
  return values[name] === true;
}

function numberValue(name: string) {
  return typeof values[name] === "number" ? values[name] as number : undefined;
}

function isVisible(field: SuanliMediaParam, ancestors = new Set<string>()): boolean {
  if (!field.showWhen) return true;
  if (ancestors.has(field.name)) return false;
  const nextAncestors = new Set(ancestors).add(field.name);
  const params = template.value?.params ?? [];
  return Object.entries(field.showWhen).every(([name, expected]) => {
    const dependency = params.find(param => param.name === name);
    return dependency !== undefined && dependency.ui !== "hidden" && dependency.ui !== "imageUpload"
      && isVisible(dependency, nextAncestors) && Object.is(values[name], expected);
  });
}

function dimensionPart(field: Extract<SuanliMediaParam, { ui: "dimension" }>, part: "width" | "height") {
  const fallback = field.dimension[part]?.min ?? 1;
  const value = stringValue(field.name).split(field.dimension.separator)[part === "width" ? 0 : 1];
  return value && /^\d+$/.test(value) ? Number(value) : fallback;
}

function setDimensionPart(field: Extract<SuanliMediaParam, { ui: "dimension" }>, part: "width" | "height", value: number | undefined) {
  const width = part === "width" ? value : dimensionPart(field, "width");
  const height = part === "height" ? value : dimensionPart(field, "height");
  setValue(field.name, width === undefined || height === undefined ? "" : `${width}${field.dimension.separator}${height}`);
}

function setValue(name: string, value: unknown) {
  values[name] = value;
  emitValues();
}

function validateField(field: SuanliMediaParam) {
  const value = values[field.name];
  if (field.ui === "hidden" || field.ui === "imageUpload") return undefined;
  if (value === undefined || value === "") {
    if (field.required) throw new Error(`请填写${field.label}`);
    return undefined;
  }
  if (field.ui === "textarea") {
    if (typeof value !== "string" || value.length > (field.maxLength ?? 20000) || (field.required && !value.trim())) throw new Error(`${field.label}无效`);
  } else if (field.ui === "switch") {
    if (typeof value !== "boolean") throw new Error(`${field.label}无效`);
  } else if (field.ui === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)
      || field.min !== undefined && value < field.min
      || field.max !== undefined && value > field.max) throw new Error(`${field.label}无效`);
  } else if (field.ui === "dimension") {
    const parts = typeof value === "string" ? value.split(field.dimension.separator) : [];
    const width = Number(parts[0]);
    const height = Number(parts[1]);
    if (parts.length !== 2 || !parts.every(part => /^\d+$/.test(part))
      || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
      || field.dimension.width?.min !== undefined && width < field.dimension.width.min
      || field.dimension.width?.max !== undefined && width > field.dimension.width.max
      || field.dimension.height?.min !== undefined && height < field.dimension.height.min
      || field.dimension.height?.max !== undefined && height > field.dimension.height.max) {
      throw new Error(`${field.label}无效`);
    }
  } else if (!field.options?.some(option => Object.is(option, value))) {
    throw new Error(`请选择有效的${field.label}`);
  }
  return value;
}

function getValues() {
  if (loading.value || loadError.value || !template.value) throw new Error(loadError.value || "正在读取模型参数");
  if (!template.value.canGenerate) throw new Error("此模型当前不支持无参考素材的生成");
  const result = Object.fromEntries(visibleParams.value.map(field => [field.name, validateField(field)]).filter(([, value]) => value !== undefined));
  const promptField = template.value.params.find(field => field.ui === "textarea" && field.name === "prompt");
  const referenceText = props.referenceText?.trim();
  if (promptField && referenceText) {
    const prompt = typeof result.prompt === "string" ? result.prompt : "";
    result.prompt = [prompt, referenceText].filter(Boolean).join("\n\n");
  }
  return result;
}

async function loadTemplate(modelRef: string, signal: AbortSignal) {
  loading.value = true;
  loadError.value = "";
  template.value = undefined;
  try {
    const config = await ai.getSuanliMediaTemplate(modelRef, signal);
    if (signal.aborted) return;
    template.value = config;
    initialize(config);
  } catch (error) {
    if (!signal.aborted) loadError.value = error instanceof Error ? error.message : "无法读取模型参数";
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}

watch(() => props.modelRef, modelRef => {
  const controller = new AbortController();
  loadController.value?.abort();
  loadController.value = controller;
  void loadTemplate(modelRef, controller.signal);
}, { immediate: true });

onScopeDispose(() => loadController.value?.abort());
defineExpose({ getValues, template });
</script>

<style scoped lang="scss">
.suanliParamsForm {
  padding: 8px 12px 4px;

  .formStatus,
  .formError {
    color: var(--el-text-color-secondary);
    font-size: 12px;
  }

  .formError { color: var(--el-color-danger); }

  .paramsForm {
    .el-form-item { margin-bottom: 12px; }
    .fieldControl { width: 100%; }

    .dimensionControl {
      display: flex;
      align-items: center;
      gap: 8px;

      .el-input-number { width: calc(50% - 14px); }
    }
  }
}
</style>
