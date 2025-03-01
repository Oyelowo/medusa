import { Request, Response } from "express"
import { OrderEditService } from "../../../../services"
import { EntityManager } from "typeorm"
import {
  defaultOrderEditFields,
  defaultOrderEditRelations,
} from "../../../../types/order-edit"

/**
 * @oas [post] /order-edits/{id}/confirm
 * operationId: "PostOrderEditsOrderEditConfirm"
 * summary: "Confirms an OrderEdit"
 * description: "Confirms an OrderEdit."
 * x-authenticated: true
 * parameters:
 *   - (path) id=* {string} The ID of the order edit.
 * x-codeSamples:
 *   - lang: JavaScript
 *     label: JS Client
 *     source: |
 *       import Medusa from "@medusajs/medusa-js"
 *       const medusa = new Medusa({ baseUrl: MEDUSA_BACKEND_URL, maxRetries: 3 })
 *       // must be previously logged in or use api token
 *       medusa.admin.orderEdits.confirm(order_edit_id)
 *         .then(({ order_edit }) => {
 *           console.log(order_edit.id)
 *         })
 *   - lang: Shell
 *     label: cURL
 *     source: |
 *       curl --location --request POST 'https://medusa-url.com/admin/order-edits/{id}/confirm' \
 *       --header 'Authorization: Bearer {api_token}'
 * security:
 *   - api_token: []
 *   - cookie_auth: []
 * tags:
 *   - OrderEdit
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             order_edit:
 *               $ref: "#/components/schemas/OrderEdit"
 *   "400":
 *     $ref: "#/components/responses/400_error"
 *   "401":
 *     $ref: "#/components/responses/unauthorized"
 *   "404":
 *     $ref: "#/components/responses/not_found_error"
 *   "500":
 *     $ref: "#/components/responses/500_error"
 */
export default async (req: Request, res: Response) => {
  const { id } = req.params

  const orderEditService = req.scope.resolve(
    "orderEditService"
  ) as OrderEditService

  const manager = req.scope.resolve("manager") as EntityManager

  const userId = req.user?.id ?? req.user?.userId

  await manager.transaction(async (transactionManager) => {
    await orderEditService
      .withTransaction(transactionManager)
      .confirm(id, { loggedInUserId: userId })
  })

  let orderEdit = await orderEditService.retrieve(id, {
    select: defaultOrderEditFields,
    relations: defaultOrderEditRelations,
  })
  orderEdit = await orderEditService.decorateTotals(orderEdit)

  return res.json({ order_edit: orderEdit })
}
