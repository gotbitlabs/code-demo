<script setup lang="ts">
import { z } from "zod";
import { useForm } from "vee-validate";
import { useDialogs } from "@/store/dialogs";
import { toTypedSchema } from "@vee-validate/zod";
import { useReadMusicTokenBalance } from "@/contracts/musicToken";
import {
  useReadStakingHasAllowance,
  useReadStakingPeriods,
} from "@/contracts/staking";

const dialogs = useDialogs();

const { balance } = useReadMusicTokenBalance();
const validationSchema = computed(() =>
  toTypedSchema(
    z.object({
      amount: z.preprocess(
        (v) => {
          if (!v) return "0";
          return Number(z.string().parse(v));
        },
        z
          .number()
          .positive()
          .max(Number(unref(balance).ui))
          .refine((x) => {
            if (!x.toString().includes(".")) return true;

            return x.toString().split(".")[1].length <= 15;
          })
      ),
      period: z.preprocess((v) => {
        if (!v) return "0";
        return Number(z.string().parse(v));
      }, z.number()),
    })
  )
);
const { handleSubmit, values, meta, setFieldValue } = useForm({
  validationSchema,
});

const onSubmit = handleSubmit((values) => {
  if (!hasAllowance.value)
    return dialogs.openDialog("approveAction", {
      amount: values.amount.toString(),
    });

  dialogs.openDialog("stakeAction", {
    ...values,
    amount: values.amount.toString(),
  });
});

const { hasAllowance } = useReadStakingHasAllowance(
  computed(() => values.amount?.toString() ?? "0")
);

const { periods: stakingPeriods } = useReadStakingPeriods();
useFieldSet(stakingPeriods, () =>
  setFieldValue("period", unref(stakingPeriods).minPeriodSec.toString())
);
</script>

<template>
  <BaseCard class="w-full max-w-[736px]">
    <form @submit="onSubmit">
      <div class="flex flex-col gap-8 px-5 pb-12 pt-8" lg="p-11">
        <StakingCardInfo
          :stake-amount="Number(values.amount as number) ?? 0"
          :stake-period="Number(values.period as string) ?? 0"
        />
        <StakingCardAmountInput
          @set-max="
            (v) => {
              setFieldValue('amount', v);
            }
          "
        />
        <StakingCardPeriodInput
          :step="'mins'"
          :selected-period="((values?.period ?? '0') as string)"
        />
        <div class="flex w-full justify-end">
          <Transition name="fade">
            <BaseButton
              v-if="hasAllowance"
              class="h-12 w-full"
              md="max-w-[312px]"
              :disabled="!meta.valid"
            >
              Stake
            </BaseButton>
            <BaseButton
              v-else
              class="h-12 w-full"
              md="max-w-[312px]"
              :disabled="!meta.valid"
            >
              Approve
            </BaseButton>
          </Transition>
        </div>
      </div>
    </form>
  </BaseCard>
</template>

<style scoped></style>
