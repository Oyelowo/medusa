import { Type } from "class-transformer"
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator"
import PriceListService from "../../../../services/price-list"
import {
  PriceListPricesCreateReq,
  PriceListStatus,
  PriceListType,
} from "../../../../types/price-list"
import { validator } from "../../../../utils/validator"

/**
 * @oas [post] /price_lists
 * operationId: "PostPriceListsPriceList"
 * summary: "Creates a Price List"
 * description: "Creates a Price List"
 * x-authenticated: true
 * requestBody:
 *   content:
 *     application/json:
 *       schema:
 *         properties:
 *           name:
 *             description: "The name of the Price List"
 *             type: string
 *           description:
 *             description: "A description of the Price List."
 *             type: string
 *           type:
 *             description: The type of the Price List.
 *             type: string
 *             enum:
 *              - sale
 *              - override
 *          status:
 *            description: The status of the Price List.
 *            type: string
 *            enum:
 *             - active
 *             - draft
 *          prices:
 *            description: The prices of the Price List.
 *            type: array
 *            items:
 *              properties:
 *                region_id:
 *                  description: The id of the Region for which the price is used.
 *                  type: string
 *                currency_code:
 *                  description: The 3 character ISO currency code for which the price will be used.
 *                  type: string
 *                amount:
 *                  description: The amount to charge for the Product Variant.
 *                  type: integer
 *                min_quantity:
 *                  description: The minimum quantity for which the price will be used.
 *                  type: integer
 *                max_quantity:
 *                  description: The maximum quantity for which the price will be used.
 *                  type: integer
 *          customer_groups:
 *            type: array
 *             description: A list of customer groups that the Price List applies to.
 *             items:
 *               required:
 *                 - id
 *               properties:
 *                 id:
 *                   description: The id of a customer group
 *                   type: string
 * tags:
 *   - Price List
 * responses:
 *   200:
 *     description: OK
 *     content:
 *       application/json:
 *         schema:
 *           properties:
 *             product:
 *               $ref: "#/components/schemas/price_list"
 */
export default async (req, res) => {
  const validated = await validator(AdminPostPriceListsPriceListReq, req.body)

  const priceListService: PriceListService =
    req.scope.resolve("priceListService")

  const product = await priceListService.create(validated)

  res.json({ product })
}

class CustomerGroup {
  @IsString()
  id: string
}

export class AdminPostPriceListsPriceListReq {
  @IsString()
  name: string

  @IsString()
  description: string

  @IsOptional()
  starts_at?: Date

  @IsOptional()
  ends_at?: Date

  @IsOptional()
  @IsEnum(PriceListStatus)
  status?: PriceListStatus

  @IsEnum(PriceListType)
  type: PriceListType

  @ValidateNested()
  prices: PriceListPricesCreateReq[]

  @IsOptional()
  @IsArray()
  @Type(() => CustomerGroup)
  @ValidateNested({ each: true })
  customer_groups?: CustomerGroup[]
}
