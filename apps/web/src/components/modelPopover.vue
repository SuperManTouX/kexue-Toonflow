<template>
  <div class="modelPopover">
    <el-popover
      v-model:visible="visible"
      trigger="click"
      placement="top-start"
      :width="340"
      :offset="10"
      :showArrow="false"
      popperClass="agentModelPopover"
      @show="loadModels"
      :popperStyle="{ padding: '20px', maxWidth: 'calc(100vw - 24px)' }">
      <template #reference>
        <el-button class="modelButton" text :disabled="disabled" aria-label="模型与推理设置">
          <modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.iconModelId" :size="14" />
          <span class="modelName">{{ selectedModelChoice?.label ?? "选择模型" }}</span>
          <template v-if="!suanliOnly || selectedSuanliModel?.kind.toLowerCase() === 'llm'"><span aria-hidden="true">·</span><span class="reasoningLabel">{{ reasoningLabel }}</span></template>
          <component :is="visible ? IconChevronUp : IconChevronDown" :size="14" aria-hidden="true" />
        </el-button>
      </template>
      <el-form class="modelOptions" labelPosition="top">
        <el-form-item label="模型">
          <el-select v-model="selectedModel" filterable :loading="loadingModels" :disabled="disabled" :teleported="false" placeholder="选择模型" aria-label="选择模型" noDataText="暂时没有可用模型" @change="reasoningEffort = ''">
            <template #prefix><modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.iconModelId" :size="18" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="model in provider.models" :key="model.id" :label="model.label" :value="JSON.stringify([suanliOnly ? 'suanli' : provider.id, model.id])">
                <el-space :size="8">
                  <modelIcon :model="model.iconModelId" :size="16" />
                  <span>{{ model.label }}</span>
                </el-space>
              </el-option>
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item v-if="!suanliOnly || selectedSuanliModel?.kind.toLowerCase() === 'llm'" label="推理等级">
          <el-segmented v-model="reasoningEffort" :options="reasoningOptions" :disabled="disabled" block aria-label="推理等级" />
        </el-form-item>
      </el-form>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import { modelIcon } from "@toonflow/model-icons";
import { customProviders, modelChoices } from "@/stores/settings";
import { ElMessage } from "element-plus";
import { getSuanliModel, refreshSuanliModels, suanliModels, suanliModelsLoaded } from "@/stores/suanli";

const selectedModel = defineModel<string>({ default: "" });
const reasoningEffort = defineModel<string>("reasoningEffort", { default: "" });
const props = withDefaults(defineProps<{ active?: boolean; disabled?: boolean; suanliOnly?: boolean }>(), { active: true, disabled: false, suanliOnly: false });
const visible = ref(false);
const loadingModels = ref(false);
const reasoningOptions = [
  { label: "默认", value: "" },
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
];
const selectedSuanliModel = computed(() => {
  if (!props.suanliOnly) return undefined;
  const parsed = parseSelectedModel(selectedModel.value);
  return parsed?.providerId === "suanli" ? getSuanliModel(parsed.modelId) : undefined;
});
const modelGroups = computed(() => {
  if (props.suanliOnly) {
    const groups = new Map<string, { id: string; label: string; models: { id: string; label: string; iconModelId: string }[] }>();
    for (const model of suanliModels.value) {
      const groupId = model.platformCode ?? "suanli";
      let group = groups.get(groupId);
      if (!group) groups.set(groupId, group = { id: groupId, label: model.platformName ?? "算力中台", models: [] });
      group.models.push({ id: model.modelRef, label: model.label, iconModelId: model.modelId });
    }
    return [...groups.values()];
  }
  return customProviders.value.toSorted((left, right) => Number(right.id === "tfRouter") - Number(left.id === "tfRouter"))
    .map(provider => ({ ...provider, models: provider.models.map(model => ({ ...model, iconModelId: model.id })) }));
});
const modelOptions = computed(() => props.suanliOnly
  ? suanliModels.value.map(model => ({ value: JSON.stringify(["suanli", model.modelRef]), providerId: "suanli", modelId: model.modelRef, iconModelId: model.modelId, label: model.platformName ? `${model.label} · ${model.platformName}` : model.label, kind: model.kind }))
  : modelChoices.value.map(model => ({ ...model, iconModelId: model.modelId })));
const selectedModelChoice = computed(() => modelOptions.value.find(item => item.value === selectedModel.value));
const reasoningLabel = computed(() => reasoningOptions.find(item => item.value === reasoningEffort.value)?.label ?? "默认");
function parseSelectedModel(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string"
      ? { providerId: parsed[0], modelId: parsed[1] } : undefined;
  } catch { return undefined; }
}
async function loadModels() {
  if (!props.suanliOnly || loadingModels.value) return;
  loadingModels.value = true;
  try { await refreshSuanliModels(); }
  catch (error) { ElMessage.warning(error instanceof Error ? error.message : "读取算力模型失败"); }
  finally { loadingModels.value = false; }
}
watch(modelChoices, items => {
  if (props.suanliOnly) return;
  if (!selectedModel.value) selectedModel.value = items[0]?.value ?? "";
}, { immediate: true });
watch([() => props.active, () => props.suanliOnly], ([active, suanliOnly]) => {
  if (active && suanliOnly && !suanliModelsLoaded.value) void loadModels();
}, { immediate: true });
watch([suanliModelsLoaded, modelOptions], ([loaded, items]) => {
  if (!props.suanliOnly || !loaded) return;
  if (!selectedModel.value) { selectedModel.value = items[0]?.value ?? ""; return; }
  if (!items.some(item => item.value === selectedModel.value)) selectedModel.value = "";
});
watch(selectedModelChoice, choice => {
  if (props.suanliOnly && choice && "kind" in choice && choice.kind.toLowerCase() !== "llm") reasoningEffort.value = "";
});
watch(() => !props.active || props.disabled, close => { if (close) visible.value = false; });
</script>

<style lang="scss">
.modelPopover {
  display: inline-flex;
  min-width: 0;
  max-width: 100%;

  .modelButton {
    max-width: 100%;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    color: var(--el-text-color-regular);

    > span {
      display: flex;
      gap: 6px;
      min-width: 0;
    }
    svg {
      flex-shrink: 0;
    }

    .reasoningLabel {
      flex-shrink: 0;
      color: var(--el-text-color-secondary);
      font-size: 12px;
    }

    .modelName {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
    }
  }
}

.agentModelPopover {
  .modelOptions {
    .el-form-item {
      margin-bottom: 24px;

      &:last-child {
        margin-bottom: 0;
      }
      .el-form-item__label {
        margin-bottom: 10px;
        font-weight: 500;
        color: var(--el-text-color-primary);
      }
      .el-segmented {
        width: 100%;

        @media (max-width: 360px) {
          .el-segmented__item {
            padding-inline: 6px;
          }
        }
      }
    }
  }
}
</style>
