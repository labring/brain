# 订阅计费：欠费状态与「待支付的套餐变更」的行业惯例

> 调研日期：2026-08-18
> 调研范围：仅一手资料（各厂商官方文档 / API reference）。不引用博客与二手文章。文中所有引文均为原文逐字，链接直达对应文档章节。
> 覆盖平台：Stripe、Paddle Billing、Chargebee、Polar、Lemon Squeezy（共 5 家）。
> 目的：为账单 UI 的两个设计选项提供事实依据 —— (a) 锁定其他套餐卡片 + 单一取消入口，vs (b) 允许点击任意套餐，在恢复对话框中解决冲突。本文只陈述各平台的做法与文档空白，**不代替团队做产品决策**。

---

## 摘要（Executive Summary）

### 问题 1：past_due / unpaid 欠费状态下，标准用户界面暴露哪些操作？

先要区分两个不同的问题：**（i）债务态下是否有恢复入口？（ii）那个入口是不是「支付某张发票」？** 五个平台对 (i) 的答案一致是「有」，对 (ii) 则明显分成两派。

**(i) 所有平台在债务态下都提供**至少一个显著的、始终可用的自助恢复入口，而且都是从催收邮件直接深链过去的。没有任何平台在欠费时把界面变成只读。Polar 甚至把这一点写成了硬保证：Customer Portal「is always available for your customers, and it can't be turned off」，其中「Cancel at period end」与「Update the default payment method」两个动作被定义为**永远可用**。

**(ii) 「支付某张未结发票」只有一半平台把它做成显式动作：**

| 平台 | 债务态下的恢复入口 | 有没有显式的「支付这张发票」？ |
| --- | --- | --- |
| Stripe | Customer Portal / Hosted Invoice Page / 催收邮件 recovery page | **有** |
| Chargebee | Self-serve portal + Pay Now / Collect Now 托管页 | **有**（可逐张勾选、支持部分支付与线下记账） |
| Paddle | past_due transaction 直接返回给 checkout | **合并进「更新支付方式」**：一个按钮 = 换卡 + 付清 |
| Polar | Customer Portal「更新默认支付方式」→ 立即重试 | **没有**（发票的动词只有 download / edit） |
| Lemon Squeezy | 催收邮件 → 更新账单信息 → 重新激活订阅 | **没有** |

Stripe 与 Chargebee 是「显式支付」派。Stripe 把「支付最新发票」定义为 `past_due` → `active` 的标准恢复路径（`active` 的定义即「对 past_due 的订阅，支付其最新发票或标记为 uncollectible 会转为 active」），并在 Customer Portal 功能表里逐字列出「Pay, download, and view current and past invoices」。Chargebee 的 Pay Now 页更进一步，「lists the invoices due for payment」，客户可「pay for all the invoices listed or select a few」。

Polar 与 Lemon Squeezy 是「隐式重试」派：不给用户「付款」这个动词，只给「更新支付方式」，由平台自动立刻重扣。

唯一的例外状态是 Stripe 的 `incomplete`（新建订阅首张发票 23 小时内未付）：此时订阅只能更新 `metadata` / `default_source` 等不产生发票的字段，23 小时后转入终态 `incomplete_expired`，发票被 void，官方建议「创建一个新订阅」而非修复旧的。

→ **对我们的直接含义：「债务态下隐藏支付/取消按钮」没有任何平台先例。** 至于恢复入口应该长成「支付这张发票」还是「更新支付方式并自动重试」，两种都有一线平台背书 —— 这是一个真实的设计选择，而不是对错问题。

### 问题 2：已发起套餐变更但发票未付时，用户再次变更套餐怎么办？

**只有 Stripe 和 Polar 正面回答了这个问题，而两家的答案一致：不阻塞，后一次变更覆盖前一次。**

Stripe 的 pending update 机制写得最明确 —— 而且「作废旧发票」是平台替你做的，不是让调用方分两步做：

> "You can update a subscription with new values for a pending update. This updates values in the `pending_update` hash, **voids the invoice associated with the previous pending update**, and creates a new invoice to reflect the updated values."

Polar 用几乎相同的措辞描述同一语义：

> "**Submitting a new update always supersedes the pending one:** … the pending update is discarded and the new change is applied right away."

Stripe 同时给出显式的「取消 pending update」路径（"To cancel a pending update, you need to void the invoice the update created."），以及自动兜底：pending update 有 23 小时（或到当前计费周期 / 试用期结束，取较早者）的过期时间，过期后 Stripe 自动 void 发票并丢弃变更。

**Paddle 是唯一明确「阻塞」的平台**，而且阻塞得很硬：`subscription_update_when_past_due`（HTTP 400，"cannot update subscription, as the subscription status is 'past_due'"），官方补救文案是「先更新支付方式脱离 past_due，再重试」。它对挂起变更也有 `subscription_locked_pending_changes`，补救是「Cancel the pending change before attempting request again.」—— 但 Paddle 在 2025 年 4 月**放宽**了后者，现在允许在已排期 pause/cancel 的订阅上增删 item、改数量。

**Chargebee 与 Lemon Squeezy 对这个场景完全沉默** —— 既没有记载阻塞，也没有记载「先作废再继续」的处方。Chargebee 有 void invoice 这块积木，但文档从未把它与「随后的套餐变更」组合成一个推荐流程；它唯一一次把两者放在一起说的是一个警告：同期先 void 再变更会**静默丢失按比例退款**。

一个值得注意的语义分歧：**变更是否原子。** Polar 明确「payment 失败则 API 报错、订阅保持不变」；Stripe 默认相反（"the subscription change request succeeds and the subscription transitions to `past_due`"），需主动用 `pending_if_incomplete` 才能得到原子语义；Lemon Squeezy 声明「takes effect immediately, regardless」但**没有说明立即扣款失败后会怎样** —— 而那恰恰是我们 UI 面对的状态。

### 问题 3：pending change 指向的价格被下架（archive）了会怎样？

**五个平台对 archive 的定义高度一致：只封堵「新增」，不影响存量续费。** Stripe：「can't be added to new invoices or subscriptions … any existing subscriptions that use the price remain active」；Chargebee：「cannot be used in new subscriptions or added to existing ones. **Existing subscriptions that already have this item price will continue to renew**」；Polar：「the product disappears from new checkouts. Existing customers keep their access, and active subscriptions keep renewing」；Paddle：archived 实体「can't be used in Paddle, though it **remains related to existing entities**」。

**但对我们真正要问的那个问题，五个平台全部沉默：**「一张已开出、尚未支付的发票，其引用的价格随后被 archive，这张发票还能不能付？」文档只覆盖了「续费」，从未覆盖「结清既存发票」。同样沉默的还有：一个指向已 archive 价格的 pending update 被重放会怎样 —— Stripe 的 pending updates 页完全没有提及 archived price。

**逃生舱是 unarchive，且被 Stripe、Polar、Paddle 明确记载**（Stripe：`active=true` / "Unarchive price"；Polar：「You can unarchive at any time from the same menu」；Paddle：「send a `PATCH` request … Include `status` as `active`」）。**Chargebee 与 Lemon Squeezy 没有记载 un-archive。**

一条 Stripe 的旁证暗示 archived price 不会阻断既存计费对象：用 `price_data` 创建的 inline price「are effectively archived (they're marked as `active=false`)」，却正常用于 Subscriptions / Invoices。但这是旁证，不是答案 —— **这一条必须在沙箱实测，不能靠文档推断。**

---

## 详细发现

### Stripe

#### S1. Subscription 状态模型

`Subscription.status` 的枚举与语义（[API reference – The Subscription object](https://docs.stripe.com/api/subscriptions/object#subscription_object-status)）：

> "Possible values are `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, or `paused`."

关键条款（同页，逐字）：

| 状态 | 官方定义要点 |
| --- | --- |
| `incomplete` | "For `collection_method=charge_automatically` a subscription moves into `incomplete` if the initial payment attempt fails. **A subscription in this status can only have metadata and default_source updated.** Once the first invoice is paid, the subscription moves into an `active` status." |
| `incomplete_expired` | "If the first invoice is not paid within 23 hours, the subscription transitions to `incomplete_expired`. **This is a terminal status, the open invoice will be voided and no further invoices will be generated.**" |
| `past_due` | "it becomes `past_due` when payment is required but cannot be paid (due to failed payment or awaiting additional user actions). Once Stripe has exhausted all payment retry attempts, the subscription will become `canceled` or `unpaid` (depending on your subscriptions settings)." |
| `unpaid` | "when a subscription has a status of `unpaid`, no subsequent invoices will be attempted (invoices will be created, but then immediately automatically closed). **After receiving updated payment information from a customer, you may choose to reopen and pay their closed invoices.**" |
| `paused` | "A subscription can only enter a `paused` status when a trial ends without a payment method. A `paused` subscription doesn't generate invoices and can be resumed after your customer adds their payment method." |

注意 `paused` ≠ pause collection：同页明确「The `paused` status is different from pausing collection, which still generates invoices and leaves the subscription's status unchanged」，而 `pause_collection` 字段的说明是「Note that the subscription status will be unchanged and will not be updated to `paused`」。

[Subscription lifecycle – Subscription statuses](https://docs.stripe.com/billing/subscriptions/overview#subscription-statuses) 的状态表进一步给出了恢复路径（英文逐字）。该表开头一句就点明了状态与可用操作的绑定关系：

> "Subscriptions can have the following statuses. **The actions you can take on a subscription depend on its status.**"

- `active`：**"For `past_due` subscriptions, paying the latest associated invoice or marking it uncollectible transitions the subscription to `active`."** 并特别提示 "`active` doesn't indicate that all outstanding invoices associated with the subscription have been paid. You can leave other outstanding invoices open for payment, mark them as uncollectible, or void them as you see fit."
- `past_due`：**"To reactivate the subscription, have your customer pay the most recent invoice. The subscription status becomes `active` regardless of whether the payment is done before or after the latest invoice due date."**
- `unpaid`：**"The latest invoice remains open and invoices continue to generate, but payments aren't attempted. Revoke access to your product when the subscription is `unpaid` because payments were already attempted and retried while `past_due`. To move the subscription to `active`, pay the most recent invoice before its due date."**

→ 这是问题 1 的直接答案：**「在 past_due 期间支付未结发票」是 Stripe 文档指定的恢复动作，而且在 `unpaid` 阶段仍然是恢复手段。**

#### S2. 重试耗尽后的三种商户配置

[Billing collection methods](https://docs.stripe.com/billing/collection-method#due-dates-for-manual-payment-invoices)（逐字）：

| Setting | Description |
| --- | --- |
| Cancel the subscription | "The subscription changes to a `canceled` status after the maximum number of days defined in the retry schedule." |
| Mark the subscription as unpaid | "The subscription changes to an `unpaid` status … Invoices continue to generate and either stay in a `draft` status or transition to a status specified in your invoice settings." |
| Leave the subscription past due | "The subscription remains in a `past_due` status … Invoices continue to be generated into an `open` status." |

同页 [Failed incomplete subscriptions](https://docs.stripe.com/billing/collection-method#failed-incomplete-subscriptions)：

> "When a subscription has a status of `incomplete`, you can only update attributes that won't result in the creation of an invoice or invoice item, such as its `metadata`, `save_default_payment_method`, and `description`."

> "When a subscription has a status of `unpaid`, Stripe creates future invoices but leaves them as drafts. In this case, **you have the option to resend the `past due` invoice and any created draft invoices to collect payment.**"

另外，[Handle unpaid subscriptions](https://docs.stripe.com/billing/subscriptions/overview#handle-unpaid-subscriptions) 明确了被 void 的发票不影响状态判定 —— 这对方案 (b)「作废旧发票」的安全性很关键：

> "If the customer doesn't pay a subscription invoice, Stripe pauses further collection attempts. The subscription continues to generate invoices each billing period, which remain in `draft` status. The subscription's status (`past_due` or `unpaid`) depends on your failed payment settings in the Dashboard."

> "**Voided invoices don't affect subscription status. Stripe determines the status from the most recent non-voided invoice.**"

#### S3. 欠费态下的用户可见操作面

**Customer Portal 功能表**（[Provide a customer portal – Features](https://docs.stripe.com/customer-management#features)），"Customer management" 一栏逐字列出客户可做的事：

> "Offer your customers the ability to:
> - Update billing information, including their tax IDs
> - Update payment methods
> - Update subscriptions
> - Cancel subscriptions immediately or at the end of the current billing period
> - **Pay, download, and view current and past invoices**"

**Portal 的限制列表**（[Limitations to modifying subscriptions](https://docs.stripe.com/customer-management#limitations-to-modifying-subscriptions)）英文逐字为以下几条，注意其中**不包含** `past_due`、`unpaid` 或 `pending_update`：

> - "If a subscription uses any of the following, **the customer can cancel it in the portal, but can't update it**: Multiple products / Usage-based billing / Sending invoices for collection / Unsupported payment methods."
> - "**Customers can't update or cancel subscriptions that currently have an update scheduled with a subscription schedule.**"
> - "Customers can only modify subscriptions if the new price has the same tax behavior as the initial price. Additionally, no modifications are allowed if the tax behavior is `unspecified` …"
> - "Customer modifications to a `trialing` subscription end the free trial and create an invoice for immediate payment."
> - "When you allow customers to switch plans, you can specify a maximum of 10 products for them to choose from."

第一条尤其值得注意：**Stripe 在需要收紧时的默认姿态是「保留取消、禁用更新」，而不是同时禁用两者。**

→ 结论：Stripe 文档**没有**把 `past_due` / `unpaid` / `pending_update` 列为 portal 内套餐切换或取消的限制条件。它显式锁定的只有 subscription schedule 一种情形。

**Hosted Invoice Page**（[Hosted invoice page](https://docs.stripe.com/invoicing/hosted-invoice-page)）——客户可以：

> - 查看发票详情、金额与状态
> - **使用任一可用支付方式支付该发票**
> - 下载 PDF 格式的发票与收据

URL 有效期：「发票 URL 在到期日后 30 天过期。若发票没有到期日，则在 finalize 后 30 天过期。任何情况下有效期都不会超过 120 天」；过期后 Dashboard/API 取到的 URL「至少保证 10 天有效」。

**催收邮件指向的 Stripe-hosted recovery page**（[Automate customer emails – Link to a Stripe-hosted page](https://docs.stripe.com/billing/revenue-recovery/customer-emails#link-to-a-stripe-hosted-page)）：

> "On that page, your customer can update their payment method for the relevant subscription **and pay any outstanding invoices if applicable**."

同节列出该链接失效的条件（对 UI 设计有直接影响）：

> "Any of the following conditions invalidate the link to the hosted payment page: … The subscription status changes to `cancelled`, `incomplete_expired`, or `unpaid`. …"

→ 即：Stripe 自己的托管恢复页在 `past_due` 期间**有效且提供支付**，进入 `unpaid` / `canceled` 后才失效。

失败支付邮件本身（同页 "Failed payment notifications"）：

> "The email lets your customer know that their recent subscription payment failed and **gives them the opportunity to update their payment method so it can be retried successfully**."

#### S4. Pending update：第二次变更如何解决冲突（问题 2 的核心）

来源：[Pending updates](https://docs.stripe.com/billing/subscriptions/pending-updates)（英文原文逐字引用）

**默认行为（不使用 pending update）**：

> "By default, Stripe applies updates regardless of whether payment on the new invoice succeeds. If payment fails, rolling back the updates is a manual process. You need to create a new invoice, prorate items on the invoice, and then initiate payment again. However, with the pending updates feature, you can make changes to subscriptions only if payment succeeds on the new invoice."

`payment_behavior` 四个取值（[API – Update a subscription](https://docs.stripe.com/api/subscriptions/update#update_subscription-payment_behavior)，逐字）：

| 值 | 语义 |
| --- | --- |
| `allow_incomplete`（默认） | "Transition the subscription to `status=past_due` if payment fails. If you have payment retries configured, Stripe automatically retries the payment." —— **变更已生效，订阅带着债务运行** |
| `default_incomplete` | "When payment is required, transition the subscription to `status=past_due` without attempting payment. You must request explicit confirmation of the Invoice's PaymentIntent." |
| `error_if_incomplete` | "If payment fails, return an HTTP `402` status code and **don't update the subscription**." —— 即前端「拒绝这次变更」 |
| `pending_if_incomplete` | "If payment fails, Stripe creates a pending update, which applies only if the payment eventually succeeds. … **This option is the simplest way to ensure the customer completes payment before Stripe applies the update.**" |

升级时若立即扣款失败，[Change the price of existing subscriptions – Immediate payment](https://docs.stripe.com/billing/subscriptions/change-price#immediate-payment) 逐字说明默认结果：

> "When billing is performed immediately, but the required payment fails, **the subscription change request succeeds and the subscription transitions to `past_due`**."

> "To bill a customer immediately for a change to a subscription on the same billing period, set `proration_behavior` to `always_invoice`. … **Combine this setting with pending updates so the subscription doesn't update unless payment succeeds on the new invoice.**"

→ 即：Stripe 的默认路径是「变更照常生效 + 订阅进入 past_due 欠一笔债」；只有主动选用 pending updates 才会出现「变更挂起、等待付款」的中间态。这正是我们 UI 面对的状态。

**处理失败支付**（"Handle failed payments" 节）：

> "For card declines, attach a new payment method to the customer. Then use the **pay** endpoint to pay the invoice that the update generates."

> "If payment fails again, the `pending_update` hash remains on the subscription with the original expiry date and no changes are applied."

**取消 / 改变 pending update**（"Optional: Cancel or change pending updates" 节，两段逐字 —— 这是问题 2 最直接的答案）：

> "**To cancel a pending update, you need to void the invoice the update created.** Check the `latest invoice` attribute on the subscription to find the invoice ID. Then use the ID to **void** the invoice."

> "**You can update a subscription with new values for a pending update. This updates values in the `pending_update` hash, voids the invoice associated with the previous pending update, and creates a new invoice to reflect the updated values.** Successful payment of this new invoice applies the most recent updates to the subscription. Payment failure generates a new pending update with a new expiry date to replace the existing one."

→ **Stripe 记录在案的模式就是「允许第二次选择，并自动作废前一张发票」，而不是阻塞。**「先取消挂起发票，再继续新选择」这一模式也被文档明确支持（void invoice 是一个独立可调用的动作）。

**自动过期兜底**（"Expired updates" 节）：

> "If you don't take any action after an update fails, Stripe voids the invoice and discards the update after it expires."

> "A pending update's `expired_at` time matches the first occurrence of either the trial end or the earliest `items.current period end`. This applies if either time is within 23 hours of the update request. **Otherwise, the expiration is 23 hours from the update request.**"

> "Stripe also automatically voids the invoice and removes the pending update if any of the following occurs: The subscription reaches a billing threshold. A subscription schedule linked to the subscription transitions to a new phase."

**Webhook 事件**（同页）：`customer.subscription.pending_update_applied`（挂起变更生效）、`customer.subscription.pending_update_expired`（"Receive notifications when pending updates expire or are automatically voided, and if needed, **try the update request again**."）。

**pending update 支持的属性有限**（同页 "Supported attributes for pending updates"）：仅 `payment_behavior`、`proration_behavior`、`proration_date`、`billing_cycle_anchor`、`items.{price,quantity,discounts}`、`trial_end`、`trial_from_plan`、`metadata`、`discounts`、`coupon`、`promotion_code`、`add_invoice_items`、`expand`。

**唯一的硬阻塞是 Checkout + `incomplete`**（[Subscription lifecycle – Update the subscription](https://docs.stripe.com/billing/subscriptions/overview#update-subscription)，英文逐字）：

> "For Stripe Checkout integrations, **you can't update the subscription or its invoice if the session's subscription is `incomplete`**. You can listen to the `checkout.session.completed` event to make the update after the session has completed. You can also **expire the session** instead if you want to cancel the session's subscription, void the subscription invoice, or mark the invoice as uncollectible."

→ 注意这里 Stripe 给出的「逃生舱」正是 (b) 式的：不是让用户干等，而是**作废掉那个未完成的会话**，让用户重新选择。

#### S5. Archive 的语义与逃生舱（问题 3）

[Manage products and prices – Archive a price](https://docs.stripe.com/products-prices/manage-prices#archive-price)（逐字）：

> "If you want to disable a price so that it **can't be added to new invoices or subscriptions**, you can archive it. If you archive a price, **any existing subscriptions that use the price remain active until they're canceled** and any existing payment links that use the product are deactivated."

同页 Archive a product：

> "If you archive a product, any existing subscriptions that use the product remain active until they're canceled …"

**Unarchive 是文档化的逃生舱**：Dashboard 有 "Unarchive price"；API 侧「To use the API to unarchive a price (that is, to indicate that it can be used for new purchases), change the `active` parameter to `true`.」删除则被明确劝阻：「You can only delete prices that you've never used. Otherwise, you can archive them.」；「You can't delete a price through the API.」

**旁证（inline price）**（同页 "Create an inline price"）：

> "By default, prices created with `price_data` are **effectively archived (they're marked as `active=false`)**." —— 而这类价格正常用于 Subscriptions、Checkout Sessions、Invoice Items、Subscription Schedules。

**文档沉默之处（明确标注）**：

- Stripe 文档**没有**说明「一张已 finalize 的 open 发票，其行项引用的 price 之后被 archive，该发票能否继续被支付」。正反两面均无表述。
- Stripe 的 [Pending updates](https://docs.stripe.com/billing/subscriptions/pending-updates) 页**完全没有提及** archived / inactive price 的交互。`pending_update.subscription_items[].price` 被 archive 后重放该变更会发生什么，文档未记载。
- Customer Portal 文档**没有**说明 archived price 是否会从 portal 的可选套餐列表中消失（配置项只说「最多 10 个 product」）。

---

### Paddle Billing

Paddle 在这三个问题上与 Stripe 形成**明显对照**：欠费态同样提供支付入口，但**明确禁止在 past_due 期间变更套餐**，并把「先付清、再变更」写进了错误码的补救说明里。

#### P1. 状态模型

[Get a subscription](https://developer.paddle.com/api-reference/subscriptions/get-subscription) 的 `status` 只有 5 个值（逐字）：

| 状态 | 定义 |
| --- | --- |
| `active` | "Subscription is active. Paddle is billing for this subscription and related transactions aren't past due." |
| `trialing` | "Subscription is in trial." |
| `past_due` | "Subscription has an overdue payment. Automatically set by Paddle when payment fails for an automatically-collected transaction." |
| `paused` | "Subscription is paused. Automatically set by Paddle when a subscription is paused." |
| `canceled` | "Subscription is canceled. Automatically set by Paddle when a subscription is canceled." |

注意：Paddle 把「已排期的变更」**移出了 status**，放进独立的 `scheduled_change` 对象 —— "Change that's scheduled to be applied to a subscription. … `null` if no scheduled changes."，其 `action` 仅有 `cancel` / `pause` / `resume`。

债务本身落在 transaction 上（[Get a transaction](https://developer.paddle.com/api-reference/transactions/get-transaction)）：

> `past_due` — "Transaction is past due. **Occurs for automatically-collected transactions when the related subscription is in dunning**, and for manually-collected transactions when payment terms have elapsed."

其余 transaction status：`draft`、`ready`、`billed`（"Billed transactions get an invoice number and are considered a legal record. They cannot be changed."）、`paid`、`completed`、`canceled`（"If an invoice, it's no longer due."）。

#### P2. Dunning 策略

[Subscription renewal and dunning](https://developer.paddle.com/build/lifecycle/subscription-renewal-dunning)：

> "If you use Paddle Billing without integrating with Paddle Retain, failed payments for automatically-collected subscriptions are **retried up to seven times over a 30-day window** before they're canceled."

> "When all payment recovery attempts are exhausted, Paddle Retain can automatically **pause or cancel** subscriptions for you."（商户可配置；文档提示已 cancel 的订阅无法恢复）

催收消息的用户入口（同页）：

> "Messages include a link to update payment information — all handled by Paddle.js on your website, **with no sign in required**."

[Webhook: subscription.past_due](https://developer.paddle.com/webhooks/subscriptions/subscription-past-due)：「Occurs when a subscription has an unpaid transaction. Its `status` changes to `past_due`.」；恢复路径为「If payment succeeds, the subscription returns to `active`」。

#### P3. past_due 下的「支付」入口 —— 有，且是一等公民

[Get a transaction to update payment method](https://developer.paddle.com/api-reference/subscriptions/update-payment-method) 逐字：

> "Returns a transaction that you can pass to a checkout to let customers update their payment details."

> "**Where a subscription is `past_due`, it returns the most recent `past_due` transaction.** Where a subscription is `active`, it creates a new zero amount transaction for the items on a subscription."

> "You can use the returned `checkout.url`, or pass the returned transaction ID to Paddle.js to open a checkout …"

[Update payment details](https://developer.paddle.com/build/subscriptions/update-payment-details/) 说明该 checkout 的界面内容：

> "When the subscription status is `past_due`, the last `past_due` transaction is returned."

> 该 checkout "Displays the items and totals for **the overdue transaction**, so that customers know they'll be charged when they update their details."，并 "Includes an 'Update payment method' button letting customers update payment details **and pay the overdue amount**."

→ 重要的结构性差异：**Paddle 不把「支付欠款」建模为独立动作，而是把它合并进「更新支付方式」的 checkout**。用户看到的是一个按钮，语义是「换卡并立即付清」。

客户门户深链（[Get a subscription](https://developer.paddle.com/api-reference/subscriptions/get-subscription) 的 `management_urls`）：

- `update_payment_method` — "Link to the page for this subscription in the customer portal with the payment method update form pre-opened."
- `cancel` — "Link to the page for this subscription in the customer portal with the subscription cancellation form pre-opened."

注意 `management_urls` 是临时令牌，webhook payload 里不含它：「Subscription management links are temporary, so they're not included」，必须实时 GET。

#### P4. past_due 期间**禁止**变更套餐（与 Stripe 相反）

Paddle 为此专门定义了错误码 —— [`subscription_update_when_past_due`](https://developer.paddle.com/errors/subscriptions/subscription_update_when_past_due)：

> Description: "cannot update subscription, as the subscription status is `past_due`"（HTTP 400，`request_error`）
>
> Remediation: "**Move the subscription out of the past_due state by updating the payment method, then try again.**"

相关错误码 [`subscription_continuing_existing_billing_period_not_allowed_subscription_past_due`](https://developer.paddle.com/errors/subscriptions/subscription_continuing_existing_billing_period_not_allowed_subscription_past_due)：「Subscription is past due because the billing period is unpaid, so the billing period cannot be continued.」

[Subscription cancellation](https://developer.paddle.com/build/lifecycle/subscription-cancellation) 同样写明，当「the next billing period is within 30 minutes, or the subscription status is `past_due`」时不能做变更（另有 [`subscription_locked_renewal`](https://developer.paddle.com/errors/subscriptions/subscription_locked_renewal) 覆盖续费锁定窗口）。

→ **Paddle 的官方模式就是「先清债、再变更」的强制排序。** 这是选项 (a) 的直接先例，但它锁的是「past_due 状态」，而不是「某张挂起发票」。

#### P5. 挂起变更（scheduled change）的锁定与解除

[`subscription_locked_pending_changes`](https://developer.paddle.com/errors/subscriptions/subscription_locked_pending_changes)：

> Description: "Subscription locked for editing while there are pending changes"；Message: "cannot update subscription, pending scheduled changes"（400）
>
> Remediation: "**Cancel the pending change before attempting request again.**"

→ 这正是我们方案 (b) 里那句「取消挂起的发票，然后继续新的选择」的文档化对应物 —— Paddle 官方补救建议就是「先取消挂起变更」。

但该限制在 2025 年 4 月被**大幅放宽**（[Changelog: update subscriptions with a scheduled change](https://developer.paddle.com/changelog/2025/update-subscriptions-scheduled-change/)）：

> "We've added the ability to **update subscriptions that are scheduled to be paused or canceled**, including adding or removing items and changing quantities."

保留的限制是计费模式：必须用 `full_immediately`、`prorated_immediately` 或 `do_not_bill`，「You can't bill changes on the next billing period.」

清除挂起变更的方式（[Update a subscription](https://developer.paddle.com/api-reference/subscriptions/update-subscription)）：

> `scheduled_change` — "When updating, **you may only set to `null` to remove a scheduled change**."

#### P6. 文档沉默之处（明确标注）

- **Paddle 没有「挂起的套餐变更」这一实体。** `scheduled_change.action` 只有 `cancel` / `pause` / `resume`；套餐/item 变更是通过 `update subscription` + proration billing mode 立即或下周期生效的，文档**未描述**「排队中的套餐变更被第二次变更取代」的语义。因此「第二次变更是否覆盖第一次」在 Paddle 文档中无答案。
- 文档**未**规定：在订阅**不是** `past_due` 但存在未结 transaction 时，是否限制套餐变更。文档化的门槛是 subscription status，不是 transaction status。
- Archived price 相关：[Get a price](https://developer.paddle.com/api-reference/prices/get-price) 定义 `archived` 为 "Entity is archived, so **can't be used**"；[Delete or archive entities](https://developer.paddle.com/api-reference/about/delete-archive-entities) 补充 "It can't be used in Paddle, **though it remains related to existing entities**"，且逃生舱是 "To unarchive an entity, send a `PATCH` request … Include `status` as `active`."。但文档**没有**说明：存量订阅引用已 archive 的 price 能否继续续费；已 `billed` / `past_due` 的 transaction 引用已 archive 的 price 能否继续支付。唯一相近的表述是 discount 的错误码 [`subscription_archived_discount_application_attempt`](https://developer.paddle.com/errors/subscriptions/subscription_archived_discount_application_attempt)（archived discount「cannot be applied to new or existing subscriptions」），但那是 discount 且针对「应用」动作，不可外推到 price 的存量计费。

---

### Chargebee

Chargebee 与 Stripe 同属「显式支付」派，但 Chargebee 的债务结清界面是五家里**最完整的**：可逐张勾选发票、支持部分支付，并且是唯一同时文档化了 void / write-off / 线下记账（Record Payment）的平台。

#### C1. 债务建模在 invoice 上，不在 subscription 上

[Subscriptions API](https://apidocs.chargebee.com/docs/api/subscriptions) 的 status 枚举为 `future`、`in_trial`、`active`、`non_renewing`、`paused`、`cancelled`、`transferred` —— **完全没有 past_due / unpaid 之类的债务状态**：

> `active`: "The subscription is active and will be charged for automatically based on the items in it."
> `non_renewing`: "The subscription will be canceled at the end of the current term."
> `paused`: "The subscription is paused. The subscription will not renew while in this state."
> `cancelled`: "The subscription has been canceled and is no longer in service."

欠费通过订阅上的汇总字段暴露（同页）：

> `due_invoices_count`: "Total number of invoices that are due for payment against the subscription."
> `due_since`: "Time since this subscription has unpaid invoices."
> `total_dues`: "Total invoice due amount for this subscription."

（文档注明这些字段 "Not supported with consolidated invoicing or hierarchy scenarios."）

债务状态落在 [Invoices](https://apidocs.chargebee.com/docs/api/invoices) 上：

> `posted` — "Indicates the payment is not yet collected and will be in this state till the due date to indicate the due period"
> `payment_due` — "Indicates the payment is not yet collected and is being retried as per retry settings."
> `not_paid` — "Indicates the payment is not made and all attempts to collect is failed."
> `voided` — "Indicates a voided invoice."

→ **结构启示：Chargebee 认为「订阅是否可用」与「有没有欠款」是两个正交的维度。** 我们的 UI 若把债务塞进订阅状态机，会比 Chargebee 的模型更纠缠。

#### C2. Dunning

[Dunning](https://www.chargebee.com/docs/2.0/dunning.html)：

> "Dunning is the process of retrying payment collection for failed transactions."

重试期间：invoice 处于 **Payment Due**，subscription 保持 **Active**。最终动作可配置为「Retain as active」（invoice 标记 Not Paid，订阅仍 active）或「Cancel subscription」。

该页唯一的客户侧入口是换卡链接：「In the email, you can provide your customers with a link to update their card details」（mail-merge 字段 `customer.card_update_url`），另有 "Collect Invoice on Card Update" 设置在换卡时立即尝试扣款。**该页本身没有记载托管支付页。**

#### C3. Pay Now：明确的「支付欠款」托管页（问题 1 的最强正面证据）

[Pay Now](https://www.chargebee.com/docs/2.0/pay-now.html)：

> "**Pay Now allows you to initiate the request for instant payment for all unpaid invoices.**"

> 链接指向 "Chargebee's Pay Now page, **which lists the invoices due for payment**."

> 客户可以 "either **pay for all the invoices listed or select a few** and make the payment"，并可以 "add a new payment method or continue with what they have saved already."

约束（同页）：「The Pay Now link is valid for five days after it is sent」；"does not support offline payments"；"The Pay Now page displays invoices only in the customer's preferred currency"；"The Pay Now page displays as a standalone page. Do not embed hosted page URLs in your own iframe elements."

生成该页的 API：[Collect Now](https://apidocs.chargebee.com/docs/api/hosted_pages/collect-now) — "This API generates a hosted page URL to collect due payments for the customer."

[Self-serve portal](https://www.chargebee.com/docs/billing/2.0/hosted-capabilities/self-serve-portal) 也把支付列为客户能力：

> "customers can modify subscriptions (add, edit, pause, resume, cancel, or reactivate), download previous invoices, manage payment methods, manage addresses and **pay unpaid invoices**."

发票级别操作（[Invoice operations](https://www.chargebee.com/docs/billing/2.0/invoices-credit-notes-and-quotes/invoice-operations)，适用于 Payment Due / Not Paid）：

> Collect Now: "you can collect full or partial payment for an invoice. **The option would not appear if there is no payment method on file.**"
> Record Payment: "you can manually record offline payments."
> Write-off: "If the invoice's due amount was not collected even after multiple attempts, Write Off operation can be used to close the invoice. … the invoice's status will be marked as Paid."

**文档沉默之处**：self-serve portal 的 widget 清单（<https://www.chargebee.com/checkout-portal-docs/portal.html>）只列出 "View / Edit Subscription details, Manage payment methods, Billing History, Manage Addresses, Manage account information" —— **没有列出未付发票的支付 widget**。也就是说「可在 portal 支付未付发票」这一能力在散文里被断言，却没有作为独立可寻址的 portal 区块被文档化。

#### C4. 未付发票下再次变更套餐 —— 文档沉默

- [Update subscription for items](https://apidocs.chargebee.com/docs/api/subscriptions/update-subscription-for-items) **完全没有**关于既存未付 / payment_due 发票的表述，也没有任何与未付发票绑定的报错或限制。它记载的约束都与此无关（backdating、term reset、usage-based billing）。
- [Subscriptions 指南](https://www.chargebee.com/docs/billing/2.0/subscriptions/subscriptions) 说明变更可「Immediately / During next renewal / On a specific date」生效，但**没有**关于发票支付状态前置条件的任何指引。

最接近的可用机制是 `invoice_immediately`（同 API 页）：

> "Determines whether charges raised immediately for the subscription are invoiced immediately or **added to unbilled charges**."

即：把变更产生的费用推入 [Unbilled Charges](https://www.chargebee.com/docs/2.0/unbilled-charges.html)（"separates the creation of subscription-related charges from their invoicing"），从源头上避免产生第二张未付发票。

清除已排期变更：[Remove scheduled changes](https://apidocs.chargebee.com/docs/api/subscriptions/remove-scheduled-changes) — "removes a scheduled change from a subscription"，并把 `has_scheduled_changes` 置为 `false`；若预开发票已计入该变更，会自动生成 `adjustment` 与 `refundable` credit note。

**⚠️ 一条对方案 (b) 直接相关的陷阱** —— [Void an invoice](https://apidocs.chargebee.com/docs/api/invoices/void-an-invoice)：

> "**If the invoice is for the current term of a subscription and you change the subscription later within the same term with proration enabled, Chargebee does not issue prorated credits.**"

这是 Chargebee 文档中**唯一**一处把「作废未付发票」与「随后同期变更订阅」联系起来的表述，而结论是：**这样做会静默地丢掉按比例退款。** 如果我们采用 (b) 的「作废旧发票再继续」，需要确认自家网关是否有同类副作用。

Void 的前置条件（同页）：状态须为 `payment_due` / `posted` / `not_paid`；"The invoice must not have any linked_payments with txn_status set to success or in_progress"；amount adjusted 须为零。

[KB: 取消带未付发票的订阅](https://www.chargebee.com/docs/billing/2.0/kb/billing/how-to-cancel-subscriptions-with-an-unpaid-invoice)：

> "Unpaid invoices result from payment failures. **You can void or delete them** from the Chargebee UI or via bulk operations."
> "Deleting data from Chargebee is not recommended."（推荐 void）

**结论：Chargebee 既没有记载「第二次变更被拒绝」，也没有记载「先作废发票再继续」的处方。** 三块积木（void、`invoice_immediately:false`、remove_scheduled_changes）都存在，但文档从未把它们组合进这个场景。

#### C5. Archived item price

[Item prices](https://apidocs.chargebee.com/docs/api/item_prices)：

> `archived` — "The item price is no longer active and **cannot be used in new subscriptions or added to existing ones. Existing subscriptions that already have this item price will continue to renew with the item price.**"

**文档沉默之处（明确标注）**：引用已 archive item price 的**既存未付发票能否被支付** —— item_prices、invoices、archiving 三处文档均未涉及；「续费」被覆盖，「发票结清」没有。此外 Chargebee **没有**记载 item price 能否 un-archive（对比 Polar 有明确记载）。

---

### Polar

Polar 借用了 Stripe 的状态枚举，但**刻意不提供「支付某张欠款发票」这个动作** —— 所有恢复都走「更新支付方式 → 立即重试」。

#### PO1. 状态与 dunning

状态枚举（来自 OpenAPI 源 `SubscriptionStatus`，见 <https://polar.sh/docs/api-reference/customer_portal/update-subscription>）与 Stripe 完全一致：`incomplete`、`incomplete_expired`、`trialing`、`active`、`past_due`、`canceled`、`unpaid`、`paused`。

[Failed payments](https://polar.sh/docs/features/subscriptions/failed-payments)：

> "When a subscription renews, Polar advances it to the next billing cycle first, then attempts to charge the customer's default payment method for the new order. If that charge fails, **the subscription moves to `past_due` and enters Polar's automated payment recovery (dunning) flow** instead of being canceled straight away."

> "1. The subscription's status moves from `active` to `past_due`, and `past_due_at` is stamped with the time of the failure. 2. **Polar emails the customer to let them know the charge failed and links them to the Customer Portal so they can update their default payment method.** 3. The renewal order stays open with `next_payment_attempt_at` set to the next retry time."

重试计划（逐字表格）：第 1 次 +2 天、第 2 次 +5 天、第 3 次 +7 天、第 4 次 +7 天（累计 21 天）。

Grace period（同页）：「Polar has an organization-level grace period that holds off benefit revocation while a subscription is in `past_due`.」，并强调 "The grace period **only delays benefit revocation**. It does not change the retry schedule, and it does not keep the subscription `active`."

**⚠️ Polar 文档自相矛盾，需实测**：[Failed payments](https://polar.sh/docs/features/subscriptions/failed-payments) 说重试耗尽后 "Its status moves to `canceled`"；而 `subscription.revoked` webhook 的说明写的是 "Happens when the subscription is canceled or payment retries are exhausted (**status becomes `unpaid`**)"。同一事件在两处给出不同终态，两者都不应直接依赖。

**文档沉默之处**：`incomplete` / `incomplete_expired` 出现在枚举里，但**散文文档中没有任何页面定义其语义**。

#### PO2. Customer Portal：没有「支付欠款」这个动作

[Customer portal introduction](https://polar.sh/docs/features/customer-portal/introduction) 的「What customers can do」完整清单：

> - View their **active subscriptions** and past **purchase history**
> - **Download and edit invoices** (e.g. add a company name, VAT number, or billing address)
> - **Download payment receipts** for every paid order …
> - **Access benefits** they're entitled to …
> - **Cancel active subscriptions** on their own
> - **Update their default payment method** — the primary way for customers to recover from failed payments
> - Optionally, do more — change their email address, switch subscription plans, manage seats, pause and resume subscriptions …

**注意发票的动词只有 download / edit，从来没有 pay。** 恢复只能间接发生：

> "The most reliable way for a customer to get back into `active` is to **update their default payment method** from the Customer Portal. **As soon as the payment method is updated, Polar retries the charge immediately** rather than waiting for the next scheduled attempt."

Portal 不可关闭：「**No.** The Customer Portal is always available for your customers, and it can't be turned off.」；且自建 portal 无法替代：「updating a default payment method is only available from the hosted Customer Portal … **Customers you send into a custom portal will still need the hosted one to recover from failed payments.**」

动作门控（[Manage subscriptions – What customers can do](https://polar.sh/docs/features/subscriptions/manage#what-customers-can-do)）：

> "**Cancel at period end** is always available — this is the self-service guarantee the portal provides."
> "**Update the default payment method** is always available — the primary way customers recover from a failed renewal."
> "**Change plan** is available when **Enable subscription plan changes** is on."

→ 即：Polar 把「取消」和「换支付方式」定义为**永远可用**的两个动作，而把「换套餐」定义为可配置项。这是一个明确的优先级排序。

**文档沉默之处**：portal 是否在界面上显示 `past_due` / `unpaid` 状态，文档从未说明；反而是让商户自己做 ——「Link prominently to the Customer Portal from your own app when a customer is `past_due`」以及「listen for the `subscription.updated` webhook and branch on `status === "past_due"`」。

#### PO3. 挂起变更被第二次变更取代（与 Stripe 一致）

[Proration](https://polar.sh/docs/features/subscriptions/proration) 的 Warning 块（逐字）：

> "For `invoice` and `prorate`, the subscription update is applied only if the immediate payment (if any) succeeds. **If the payment fails, the API returns an error and the subscription stays unchanged.**"

→ Polar 的默认语义就是 Stripe 的 `error_if_incomplete` + `pending_if_incomplete` 的混合：变更是原子的，失败不留中间态。

对于 `next_period` 这种真正的挂起变更（同页，**这是问题 2 的直接答案**）：

> "While a `next_period` update is pending, the subscription's `pending_update` field describes the scheduled change. **Submitting a new update always supersedes the pending one:** if you scheduled a `next_period` change and then make another update with `invoice` or `prorate`, **the pending update is discarded and the new change is applied right away.**"

→ **Polar 与 Stripe 在这一点上完全一致：不阻塞，后写覆盖先写。**

已文档化的套餐变更限制（[Change the plan](https://polar.sh/docs/features/subscriptions/manage#change-the-plan)）：币种须一致；seat-based 单向；"**You can't change the plan on a subscription that's already canceled or scheduled to cancel — uncancel first.**"；trialing 允许；custom-priced 产品不能作为目标。**这份清单里没有 `past_due` 或 `unpaid`。**

customer-portal 变更接口（`PATCH /v1/customer-portal/subscriptions/{id}`）的完整错误枚举：`402`（"Payment required to apply the subscription update."）、`403`（已取消 / 无权限 / 未启用暂停恢复）、`404`、`409`（"The subscription has no payment method to charge."）、`422`。**没有任何一个错误码对应「past_due」或「有未结发票」** —— 这是有意义的反面证据，但仍不构成「允许」的正面表述。

**文档沉默之处（明确标注）**：Polar 从未说明 (a) 在 `past_due` 状态下做套餐变更时，此前那张未付的续费 order 会怎样；(b) `past_due` / `unpaid` 下是否允许变更；(c) 有无作废未结 order 的逃生舱 —— **Polar 没有任何等价于 Chargebee "void an invoice" 的能力。**

#### PO4. Archived product

[Products – Archive a product](https://polar.sh/docs/features/products)：

> "Products can be archived but not permanently deleted. Click **Archive** from the product menu and the product disappears from new checkouts."
> "Existing customers keep their access, and active subscriptions keep renewing. **You can unarchive at any time from the same menu to make the product available again.**"

**文档沉默之处**：archived product 处于 `next_period` 挂起变更中会怎样；引用 archived product 的既存未结 order 能否支付 —— 均未说明。

---

### Lemon Squeezy

（作为第四个对照点收录。其 dunning 语义与 Polar / Stripe 有一处重要差异：**`past_due` 期间保留访问权**。）

#### L1. 状态与 dunning

[The subscription object](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object)：

> `past_due` — "A renewal payment has failed. The subscription will go through **4 payment retries over the course of 2 weeks**. If a retry is successful, the subscription's status changes back to `active`. If all four retries are unsuccessful, the status is changed to `unpaid`."
> `unpaid` — "Payment recovery has been unsuccessful in capturing a payment after 4 attempts. If dunning is enabled in your store, your dunning rules now will determine if the subscription becomes `expired` after a certain period. If dunning is turned off, the status remains `unpaid`."
> `expired` — "The subscription has ended … Customers should no longer have access to your product."

[Recovery & dunning](https://docs.lemonsqueezy.com/help/online-store/recovery-dunning)：

> "Each time a payment fails, the customer will be notified by email and asked to update their billing information. **During this period, the subscription will appear as past due in the dashboard, will remain active and the customer will continue to have access to the subscription's content.**"

> "When the final payment fails, the subscription will become **unpaid** and the customer will lose access …"

> dunning 邮件 "include a link to **a payment page where the customer can update their billing information and re-activate their subscription.**"

> "you can also choose to leave the subscription as 'unpaid' which will allow **the customer to re-activate it at any time**."

→ **访问权切断点在 `unpaid`，而不是 `past_due`** —— 与 Polar（默认立即撤销）相反，与 Stripe 的建议（"Revoke access to your product when the subscription is `unpaid`"）一致。

#### L2. 托管入口

`urls` 对象（[The subscription object](https://docs.lemonsqueezy.com/api/subscriptions/the-subscription-object)）：

> `update_payment_method` — "A pre-signed URL for managing payment and billing information for the subscription. **The URL is valid for 24 hours from time of request.**"
> `customer_portal` — "A pre-signed URL to the Customer Portal, which allows customers to fully manage their subscriptions and billing information …"

[Customer portal](https://docs.lemonsqueezy.com/help/online-store/customer-portal) 能力清单：

> "Customers can view active and expired subscriptions … plus a full billing history"
> "Customers can easily change between different subscription products, pause/unpause and cancel/resume subscriptions"
> "add, edit and delete payment methods …"

**文档沉默之处**：与 Polar 相同 —— **portal 能力清单里没有「支付某张未结发票」**，恢复路径统一是「更新账单信息 → 重新激活订阅」。

#### L3. 变更套餐

[Update subscription](https://docs.lemonsqueezy.com/api/subscriptions/update-subscription)：

> `invoice_immediately` — "If `true`, any updates to the subscription will be charged immediately. **A new prorated invoice will be generated and payment attempted.** Defaults to `false`."
> `disable_prorations` — "If `true`, no proration will be charged and the customer will simply be charged the new price at the next renewal."

[开发者指南](https://docs.lemonsqueezy.com/guides/developer-guide/managing-subscriptions)：

> "**The plan change takes effect immediately, regardless of the proration option chosen.**"

**⚠️ 与 Polar 正相反**：Polar 是「付款成功才应用变更」，Lemon Squeezy 是「无论如何立即应用」。而 **LS 文档没有说明这笔立即扣款失败后会发生什么** —— 变更已生效、却留下一笔欠款，这个状态的语义是空白的。这恰好是我们 UI 正在面对的那个状态。

唯一记载的硬阻塞是 PayPal（同 API 页）：

> "For all subscriptions that have PayPal as their payment system, the update endpoint **will not modify** the subscription. Instead the subscription object will have a value present in the `urls.customer_portal_update_subscription` key. You can use this value to **redirect your customer to the Customer Portal** to allow a succesful subscription modification."

→ 注意 LS 处理「不能在此处变更」的方式：**不是禁用按钮，而是把用户重定向到能完成该操作的地方。**

**文档沉默之处**：未付发票下再次变更套餐 —— 无任何记载，无阻塞说明，无作废发票的模式，无对应错误码。archived / deleted variant 对既存订阅与未结发票的影响 —— 同样完全没有文档。

---

## 对我们方案 (a) vs (b) 的映射

本节只做「事实 → 选项」的映射，不替产品做决定。

### 先说一个与 (a)/(b) 无关、但需要单独处理的结论

**债务态下隐藏恢复入口，没有任何平台先例。** 五个平台无一例外，都在债务状态下保留了显著的自助恢复入口，并从催收邮件直接深链过去。Polar 把它写成了不可关闭的产品保证。

但要注意这个入口的**形态有两派**，两派都有一线平台背书（详见摘要问题 1 的对照表）：

- **显式支付派**（Stripe、Chargebee）：给用户「支付这张发票」的动词。Chargebee 甚至支持逐张勾选与部分支付。
- **隐式重试派**（Polar、Lemon Squeezy）：只给「更新支付方式」，平台自动立刻重扣。Polar 明确「As soon as the payment method is updated, Polar retries the charge immediately」。
- Paddle 走中间路线：一个按钮同时完成换卡与付清。

所以「恢复欠费」这件事有真实的设计自由度，但**「什么都不给」不在选项之内**。这个问题独立于 (a)/(b)，应先单独修正。

「取消」入口同理，而且证据更强：Stripe 在需要收紧时的默认姿态是「保留取消、禁用更新」（"the customer can cancel it in the portal, but can't update it"）；Polar 把「Cancel at period end」列为**永远可用**的自助保证。**没有平台把取消和更新一起禁用。**

### 选项 (a)：锁定其他套餐卡片 + 单一取消入口

**支持 (a) 的一手证据：**

- **Paddle 就是这么做的，而且是硬性的。** `subscription_update_when_past_due`（HTTP 400）在 `past_due` 期间拒绝一切订阅更新，官方补救文案就是「先更新支付方式，再重试」。若我们的 pending upgrade 会把订阅置于类 past_due 的债务态，(a) 有直接先例。
- **Paddle 对挂起变更的官方补救也是「先取消」**：`subscription_locked_pending_changes` 的 remediation 是 "Cancel the pending change before attempting request again."。这与 (a) 的「单一取消入口」在语义上完全吻合。
- **Stripe 也有锁定的先例**，尽管范围窄：Customer Portal 明确「Customers can't update or cancel subscriptions that currently have an update scheduled with a subscription schedule.」——存在一个已排期变更时，连取消都不给。
- Stripe 的 `error_if_incomplete`（"If payment fails, return an HTTP 402 … and don't update the subscription"）说明「拒绝这次变更」也是平台认可的一档行为。

**(a) 需要正视的成本：**

- **Paddle 是五家里唯一这么做的**，而且它自己在 2025 年 4 月**放宽**了挂起变更那把锁：现在允许在已排期 pause/cancel 的订阅上增删 item、改数量，只是限定了 proration 模式。方向是从「锁」走向「有条件放行」。
- **Stripe 与 Polar 的限制清单都明确列举过，且都不含 past_due / unpaid / pending update。** Polar 的 customer-portal 变更接口错误码枚举完整（402/403/404/409/422），其中没有任何一个对应债务状态 —— 这是有意义的反面证据。
- 若锁定是全局的（所有卡片都不可点），用户想「换个更便宜的方案」时会被迫走「取消 → 重新选择」两步，而这正是 (b) 用一步完成的事。
- 注意 Paddle 锁的粒度是**订阅状态**（past_due），不是**某张挂起发票**。若我们照搬 (a) 但锁的是后者，那不是 Paddle 的模式，而是一个没有平台先例的第三种模式。

### 选项 (b)：允许点击任意套餐，在恢复对话框中解决冲突

**支持 (b) 的一手证据（这是本次调研最强的单条发现）：**

- **Stripe 明确把「第二次变更自动作废第一张发票」记录为受支持的行为**，且是一次操作而非两步：

  > "You can update a subscription with new values for a pending update. This updates values in the `pending_update` hash, **voids the invoice associated with the previous pending update**, and creates a new invoice to reflect the updated values."

  这几乎是 (b) 的逐字规格说明：用户点新套餐 → 旧发票作废 → 新发票生成 → 付款成功即生效。
- **「取消挂起发票再继续」这一模式同样被 Stripe 文档化**为独立动作（"To cancel a pending update, you need to void the invoice the update created."），所以 (b) 的恢复对话框文案「取消挂起的发票并继续新的购买」对应的是两个都受支持的原语。
- **Stripe 有自动兜底**：pending update 23 小时（或到周期/试用结束，取较早者）后自动 void 发票并丢弃变更，并发出 `customer.subscription.pending_update_expired`，官方建议此时「try the update request again」。这意味着 (b) 的冲突窗口本身是有界的，不需要 UI 承担永久清理责任。
- **Polar 独立给出了同样的语义**，措辞几乎与 Stripe 一致：「Submitting a new update always supersedes the pending one … the pending update is discarded and the new change is applied right away.」两家互不相干的平台收敛到同一设计，是比单一来源更强的证据。
- **Paddle 的 remediation 文案也指向同一动作序列**（先 cancel pending change 再重试），只是 Paddle 让调用方分两步做，而 Stripe / Polar 合并成一步。(b) 相当于把这个序列藏在对话框后面替用户完成。
- **Lemon Squeezy 展示了 (b) 式的兜底姿态**：遇到「此处无法变更」（PayPal 订阅）时，它不是禁用按钮，而是把用户**重定向到能完成该操作的地方**。

**(b) 需要正视的成本：**

- 这条 Stripe 路径**只在 `pending_if_incomplete` 语义下成立**。如果我们的实现走的是 Stripe 默认的 `allow_incomplete`（"the subscription change request succeeds and the subscription transitions to `past_due`"），那么第一次变更**已经生效**了，此时的「冲突」不是「两个挂起变更」而是「已生效的变更 + 一笔欠款」，(b) 的「取消挂起发票」话术就不成立。**先确认我们处在哪一档，是选择 (a)/(b) 的前置问题。**
- pending update 支持的属性有限（仅 `items.{price,quantity,discounts}`、`trial_end`、折扣类等）。若恢复对话框需要同时改动其他字段，超出这个白名单就无法走同一条路径。
- **Paddle 侧无对应能力**：它没有「挂起的套餐变更」实体，也没有文档说明第二次变更覆盖第一次。若要保留多网关抽象，(b) 的语义在 Paddle 上需自己实现（先 cancel、后重试），而不是依赖网关。
- **⚠️ Chargebee 记载了一个副作用，值得在我们自己的实现里排查**：「If the invoice is for the current term of a subscription and you change the subscription later within the same term with proration enabled, Chargebee does not issue prorated credits.」—— 即「作废未付发票 → 同期变更套餐」会**静默丢掉按比例退款**。(b) 的核心动作恰好就是这个序列。

### 两个选项都需要回答的、文档给不出答案的问题

- **已 finalize 的发票，其价格随后被 archive，还能不能付？** **五个平台全部沉默。** 所有平台都只说明 archive 阻止「加入新的发票/订阅」并保证存量**续费**不受影响，没有一家说明既存**未付发票**的可结清性。如果我们的下架流程会让用户卡在一张不可支付的发票上，这**必须在沙箱里实测**。
- **重放一个指向已 archive 价格的 pending update 会怎样？** Stripe 的 pending updates 页与 Polar 的 proration 页都完全没有提及 archived price。同样需要实测。
- **第二次变更遇上未付发票，Chargebee 与 Lemon Squeezy 也是沉默的。** 换言之：五家里只有 Stripe 和 Polar 正面记载了这个交互，且都是「后写覆盖」。若我们的网关不是这两家，文档给不出答案，只能实测。
- 一个可从文档推出的设计缓冲：因为 unarchive 是多数平台唯一记录在案的补救手段（且 Chargebee / Lemon Squeezy 连这个都没记载），任何「下架价格」的运营动作都应保证挂起变更窗口（Stripe 侧最长 23 小时）内的可回滚性，否则用户侧无解。

### 两处厂商文档缺陷，应当视为风险而非事实

- **Polar 自相矛盾**：重试耗尽后的终态，failed-payments 页说是 `canceled`，`subscription.revoked` webhook 说明说是 `unpaid`。
- **Lemon Squeezy 有空白**：它声明套餐变更「takes effect immediately, regardless of the proration option chosen」，却从未说明这笔立即扣款失败后会发生什么 —— 而「变更已生效 + 留下一笔欠款」正是我们 UI 要处理的那个状态。
