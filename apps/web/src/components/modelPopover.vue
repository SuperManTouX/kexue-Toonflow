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
      :popperStyle="{ padding: '20px', maxWidth: 'calc(100vw - 24px)' }">
      <template #reference>
        <el-button class="modelButton" text :disabled="disabled" aria-label="模型与推理设置">
          <modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.modelId" :size="14" />
          <span class="modelName">{{ selectedModelChoice?.label ?? "选择模型" }}</span>
          ·
          <span class="reasoningLabel">{{ reasoningLabel }}</span>
          <component :is="visible ? IconChevronUp : IconChevronDown" :size="14" aria-hidden="true" />
        </el-button>
      </template>
      <el-form class="modelOptions" labelPosition="top">
        <el-form-item v-if="suanliAvailable" label="SXWZ 算力">
          <div class="suanliAccount">
            <span>{{ suanliStatusReady ? suanliUser?.name ?? "未登录" : "读取登录状态中" }}</span>
            <el-button v-if="suanliUser" text size="small" :disabled="suanliLoading" @click="logout">退出</el-button>
            <el-button v-else text size="small" @click="loginVisible = true">登录</el-button>
            <el-button v-if="suanliUser" text size="small" :loading="suanliLoading" @click="refreshModels">刷新模型</el-button>
          </div>
          <span v-if="suanliError" class="suanliError">{{ suanliError }}</span>
        </el-form-item>
        <el-form-item label="模型">
          <el-select v-model="selectedModel" filterable :disabled="disabled" :teleported="false" placeholder="选择模型" aria-label="选择模型" noDataText="请先登录 SXWZ 算力" @change="reasoningEffort = ''">
            <template #prefix><modelIcon v-if="selectedModelChoice" :model="selectedModelChoice.modelId" :size="18" /></template>
            <el-option-group v-for="provider in modelGroups" :key="provider.id" :label="provider.label">
              <el-option v-for="model in provider.models" :key="model.id" :label="model.label" :value="JSON.stringify([model.providerId ?? provider.id, model.id])">
                <el-space :size="8">
                  <modelIcon :model="model.id" :size="16" />
                  <span>{{ model.label }}</span>
                </el-space>
              </el-option>
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="推理等级">
          <el-segmented v-model="reasoningEffort" :options="reasoningOptions" :disabled="disabled" block aria-label="推理等级" />
        </el-form-item>
      </el-form>
    </el-popover>
    <suanliLoginDialog v-model:visible="loginVisible" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-vue";
import { modelIcon } from "@toonflow/model-icons";
import { ElMessage } from "element-plus";
import suanliLoginDialog from "@/components/suanliLoginDialog.vue";
import { agentModelChoices, agentModelGroups, loadSuanliStatus, logoutSuanli, refreshSuanliModels, suanliAvailable, suanliError, suanliLoading, suanliStatusReady, suanliUser } from "@/stores/suanli";

const selectedModel = defineModel<string>({ default: "" });
const reasoningEffort = defineModel<string>("reasoningEffort", { default: "" });
const props = withDefaults(defineProps<{ active?: boolean; disabled?: boolean }>(), { active: true, disabled: false });
const visible = ref(false);
const loginVisible = ref(false);
const reasoningOptions = [
  { label: "默认", value: "" },
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
];
const modelGroups = agentModelGroups;
const selectedModelChoice = computed(() => agentModelChoices.value.find(item => item.value === selectedModel.value));
const reasoningLabel = computed(() => reasoningOptions.find(item => item.value === reasoningEffort.value)?.label ?? "默认");
watch(agentModelChoices, items => {
  if (!items.some(item => item.value === selectedModel.value)) selectedModel.value = items[0]?.value ?? "";
}, { immediate: true });
watch(() => !props.active || props.disabled, close => { if (close) visible.value = false; });
watch(visible, open => { if (open && suanliAvailable) void loadSuanliStatus().catch(() => {}); });

async function refreshModels() {
  try { await refreshSuanliModels(); }
  catch { /* 错误在账号区域展示。 */ }
}

async function logout() {
  try { await logoutSuanli(); ElMessage.success("已退出 SXWZ 算力"); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : "退出 SXWZ 算力失败"); }
}
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
    .suanliAccount {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 4px;
      min-height: 32px;
    }

    .suanliError {
      display: block;
      margin-top: 6px;
      color: var(--el-color-danger);
      font-size: 12px;
    }

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
