import { isDefined, MedusaError } from "medusa-core-utils"
import { EntityManager, In } from "typeorm"
import {
  IStockLocationService,
  IInventoryService,
  TransactionBaseService,
} from "../interfaces"
import { ProductVariantInventoryItem } from "../models/product-variant-inventory-item"
import { ProductVariantService, SalesChannelLocationService } from "./"
import { InventoryItemDTO, ReserveQuantityContext } from "../types/inventory"
import { LineItem, ProductVariant } from "../models"

type InjectedDependencies = {
  manager: EntityManager
  salesChannelLocationService: SalesChannelLocationService
  productVariantService: ProductVariantService
  stockLocationService: IStockLocationService
  inventoryService: IInventoryService
}

class ProductVariantInventoryService extends TransactionBaseService {
  protected manager_: EntityManager
  protected transactionManager_: EntityManager | undefined

  protected readonly salesChannelLocationService_: SalesChannelLocationService
  protected readonly productVariantService_: ProductVariantService
  protected readonly stockLocationService_: IStockLocationService
  protected readonly inventoryService_: IInventoryService

  constructor({
    manager,
    stockLocationService,
    salesChannelLocationService,
    productVariantService,
    inventoryService,
  }: InjectedDependencies) {
    // eslint-disable-next-line prefer-rest-params
    super(arguments[0])

    this.manager_ = manager
    this.salesChannelLocationService_ = salesChannelLocationService
    this.stockLocationService_ = stockLocationService
    this.productVariantService_ = productVariantService
    this.inventoryService_ = inventoryService
  }

  /**
   * confirms if requested inventory is available
   * @param variantId id of the variant to confirm inventory for
   * @param quantity quantity of inventory to confirm is available
   * @param context optionally include a sales channel if applicable
   * @returns boolean indicating if inventory is available
   */
  async confirmInventory(
    variantId: string,
    quantity: number,
    context: { salesChannelId?: string | null } = {}
  ): Promise<Boolean> {
    if (!variantId) {
      return true
    }

    const manager = this.transactionManager_ || this.manager_
    const productVariant = await this.productVariantService_
      .withTransaction(manager)
      .retrieve(variantId, {
        select: [
          "id",
          "allow_backorder",
          "manage_inventory",
          "inventory_quantity",
        ],
      })

    // If the variant allows backorders or if inventory isn't managed we
    // don't need to check inventory
    if (productVariant.allow_backorder || !productVariant.manage_inventory) {
      return true
    }

    if (!this.inventoryService_) {
      return productVariant.inventory_quantity >= quantity
    }

    const variantInventory = await this.listByVariant(variantId)

    // If there are no inventory items attached to the variant we default
    // to true
    if (variantInventory.length === 0) {
      return true
    }

    let locations: string[] = []
    if (context.salesChannelId) {
      locations = await this.salesChannelLocationService_.listLocations(
        context.salesChannelId
      )
    } else {
      const stockLocations = await this.stockLocationService_.list(
        {},
        { select: ["id"] }
      )
      locations = stockLocations.map((l) => l.id)
    }

    const hasInventory = await Promise.all(
      variantInventory.map(async (inventoryPart) => {
        const itemQuantity = inventoryPart.quantity * quantity
        return await this.inventoryService_.confirmInventory(
          inventoryPart.inventory_item_id,
          locations,
          itemQuantity
        )
      })
    )

    return hasInventory.every(Boolean)
  }

  /**
   * Retrieves a product variant inventory item by its inventory item ID and variant ID.
   *
   * @param inventoryItemId - The ID of the inventory item to retrieve.
   * @param variantId - The ID of the variant to retrieve.
   * @returns A promise that resolves with the product variant inventory item.
   */
  async retrieve(
    inventoryItemId: string,
    variantId: string
  ): Promise<ProductVariantInventoryItem> {
    const manager = this.transactionManager_ || this.manager_

    const variantInventoryRepo = manager.getRepository(
      ProductVariantInventoryItem
    )

    const variantInventory = await variantInventoryRepo.findOne({
      where: { inventory_item_id: inventoryItemId, variant_id: variantId },
    })

    if (!variantInventory) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory item with id ${inventoryItemId} not found`
      )
    }

    return variantInventory
  }

  /**
   * list registered inventory items
   * @param itemIds list inventory item ids
   * @returns list of inventory items
   */
  async listByItem(itemIds: string[]): Promise<ProductVariantInventoryItem[]> {
    const manager = this.transactionManager_ || this.manager_

    const variantInventoryRepo = manager.getRepository(
      ProductVariantInventoryItem
    )

    const variantInventory = await variantInventoryRepo.find({
      where: { inventory_item_id: In(itemIds) },
    })

    return variantInventory
  }

  /**
   * List inventory items for a specific variant
   * @param variantId variant id
   * @returns variant inventory items for the variant id
   */
  private async listByVariant(
    variantId: string | string[]
  ): Promise<ProductVariantInventoryItem[]> {
    const manager = this.transactionManager_ || this.manager_

    const variantInventoryRepo = manager.getRepository(
      ProductVariantInventoryItem
    )

    const ids = Array.isArray(variantId) ? variantId : [variantId]

    const variantInventory = await variantInventoryRepo.find({
      where: { variant_id: In(ids) },
    })

    return variantInventory
  }

  /**
   * lists variant by inventory item id
   * @param itemId item id
   * @returns a list of product variants that are associated with the item id
   */
  async listVariantsByItem(itemId: string): Promise<ProductVariant[]> {
    if (!this.inventoryService_) {
      return []
    }

    const variantInventory = await this.listByItem([itemId])
    const items = await this.productVariantService_.list({
      id: variantInventory.map((i) => i.variant_id),
    })

    return items
  }

  /**
   * lists inventory items for a given variant
   * @param variantId variant id
   * @returns lidt of inventory items for the variant
   */
  async listInventoryItemsByVariant(
    variantId: string
  ): Promise<InventoryItemDTO[]> {
    if (!this.inventoryService_) {
      return []
    }

    const variantInventory = await this.listByVariant(variantId)
    const [items] = await this.inventoryService_.listInventoryItems({
      id: variantInventory.map((i) => i.inventory_item_id),
    })

    return items
  }

  /**
   * Attach a variant to an inventory item
   * @param variantId variant id
   * @param inventoryItemId inventory item id
   * @param quantity quantity of variant to attach
   * @returns the variant inventory item
   */
  async attachInventoryItem(
    variantId: string,
    inventoryItemId: string,
    quantity?: number
  ): Promise<ProductVariantInventoryItem> {
    const manager = this.transactionManager_ || this.manager_

    // Verify that variant exists
    await this.productVariantService_
      .withTransaction(manager)
      .retrieve(variantId, {
        select: ["id"],
      })

    // Verify that item exists
    await this.inventoryService_.retrieveInventoryItem(inventoryItemId, {
      select: ["id"],
    })

    const variantInventoryRepo = manager.getRepository(
      ProductVariantInventoryItem
    )

    const existing = await variantInventoryRepo.findOne({
      where: {
        variant_id: variantId,
        inventory_item_id: inventoryItemId,
      },
    })

    if (existing) {
      return existing
    }

    let quantityToStore = 1
    if (typeof quantity !== "undefined") {
      if (quantity < 1) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Quantity must be greater than 0"
        )
      } else {
        quantityToStore = quantity
      }
    }

    const variantInventory = variantInventoryRepo.create({
      variant_id: variantId,
      inventory_item_id: inventoryItemId,
      quantity: quantityToStore,
    })

    return await variantInventoryRepo.save(variantInventory)
  }

  /**
   * Remove a variant from an inventory item
   * @param variantId variant id
   * @param inventoryItemId inventory item id
   */
  async detachInventoryItem(
    variantId: string,
    inventoryItemId: string
  ): Promise<void> {
    const manager = this.transactionManager_ || this.manager_

    const variantInventoryRepo = manager.getRepository(
      ProductVariantInventoryItem
    )

    const existing = await variantInventoryRepo.findOne({
      where: {
        variant_id: variantId,
        inventory_item_id: inventoryItemId,
      },
    })

    if (existing) {
      await variantInventoryRepo.remove(existing)
    }
  }

  /**
   * Reserves a quantity of a variant
   * @param variantId variant id
   * @param quantity quantity to reserve
   * @param context optional parameters
   */
  async reserveQuantity(
    variantId: string,
    quantity: number,
    context: ReserveQuantityContext = {}
  ): Promise<void> {
    const manager = this.transactionManager_ || this.manager_

    if (!this.inventoryService_) {
      return this.atomicPhase_(async (manager) => {
        const variantServiceTx =
          this.productVariantService_.withTransaction(manager)
        const variant = await variantServiceTx.retrieve(variantId, {
          select: ["id", "inventory_quantity"],
        })
        await variantServiceTx.update(variant.id, {
          inventory_quantity: variant.inventory_quantity - quantity,
        })
        return
      })
    }

    const toReserve = {
      type: "order",
      line_item_id: context.lineItemId,
    }

    const variantInventory = await this.listByVariant(variantId)

    if (variantInventory.length === 0) {
      return
    }

    let locationId = context.locationId
    if (!isDefined(locationId) && context.salesChannelId) {
      const locations = await this.salesChannelLocationService_
        .withTransaction(manager)
        .listLocations(context.salesChannelId)

      if (!locations.length) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Must provide location_id or sales_channel_id to a Sales Channel that has associated Stock Locations"
        )
      }

      locationId = locations[0]
    }

    await Promise.all(
      variantInventory.map(async (inventoryPart) => {
        const itemQuantity = inventoryPart.quantity * quantity
        return await this.inventoryService_.createReservationItem({
          ...toReserve,
          location_id: locationId as string,
          inventory_item_id: inventoryPart.inventory_item_id,
          quantity: itemQuantity,
        })
      })
    )
  }

  /**
   * Adjusts the quantity of reservations for a line item by a given amount.
   * @param {string} lineItemId - The ID of the line item
   * @param {string} variantId - The ID of the variant
   * @param {string} locationId - The ID of the location to prefer adjusting quantities at
   * @param {number} quantity - The amount to adjust the quantity by
   */
  async adjustReservationsQuantityByLineItem(
    lineItemId: string,
    variantId: string,
    locationId: string,
    quantity: number
  ): Promise<void> {
    if (!this.inventoryService_) {
      return this.atomicPhase_(async (manager) => {
        const variantServiceTx =
          this.productVariantService_.withTransaction(manager)
        const variant = await variantServiceTx.retrieve(variantId, {
          select: ["id", "inventory_quantity", "manage_inventory"],
        })

        if (!variant.manage_inventory) {
          return
        }

        await variantServiceTx.update(variantId, {
          inventory_quantity: variant.inventory_quantity - quantity,
        })
      })
    }
    const [reservations, reservationCount] =
      await this.inventoryService_.listReservationItems(
        {
          line_item_id: lineItemId,
        },
        {
          order: { created_at: "DESC" },
        }
      )

    if (reservationCount) {
      let reservation = reservations[0]

      reservation =
        reservations.find(
          (r) => r.location_id === locationId && r.quantity >= quantity
        ) ?? reservation

      const productVariantInventory = await this.retrieve(
        reservation.inventory_item_id,
        variantId
      )

      const reservationQtyUpdate =
        reservation.quantity - quantity * productVariantInventory.quantity

      if (reservationQtyUpdate === 0) {
        await this.inventoryService_.deleteReservationItem(reservation.id)
      } else {
        await this.inventoryService_.updateReservationItem(reservation.id, {
          quantity: reservationQtyUpdate,
        })
      }
    }
  }

  /**
   * Validate stock at a location for fulfillment items
   * @param items Fulfillment Line items to validate quantities for
   * @param locationId Location to validate stock at
   * @returns nothing if successful, throws error if not
   */
  async validateInventoryAtLocation(items: LineItem[], locationId: string) {
    if (!this.inventoryService_) {
      return
    }

    const itemsToValidate = items.filter((item) => item.variant_id)

    for (const item of itemsToValidate) {
      const pvInventoryItems = await this.listByVariant(item.variant_id!)

      const [inventoryLevels] =
        await this.inventoryService_.listInventoryLevels({
          inventory_item_id: pvInventoryItems.map((i) => i.inventory_item_id),
          location_id: locationId,
        })

      const pviMap: Map<string, ProductVariantInventoryItem> = new Map(
        pvInventoryItems.map((pvi) => [pvi.inventory_item_id, pvi])
      )

      for (const inventoryLevel of inventoryLevels) {
        const pvInventoryItem = pviMap[inventoryLevel.inventory_item_id]

        if (
          !pvInventoryItem ||
          pvInventoryItem.quantity * item.quantity >
            inventoryLevel.stocked_quantity
        ) {
          throw new MedusaError(
            MedusaError.Types.NOT_ALLOWED,
            `Insufficient stock for item: ${item.title}`
          )
        }
      }
    }
  }

  /**
   * delete a reservation of variant quantity
   * @param lineItemId line item id
   * @param variantId variant id
   * @param quantity quantity to release
   */
  async deleteReservationsByLineItem(
    lineItemId: string,
    variantId: string,
    quantity: number
  ): Promise<void> {
    if (!this.inventoryService_) {
      return this.atomicPhase_(async (manager) => {
        const productVariantServiceTx =
          this.productVariantService_.withTransaction(manager)
        const variant = await productVariantServiceTx.retrieve(variantId, {
          select: ["id", "inventory_quantity", "manage_inventory"],
        })

        if (!variant.manage_inventory) {
          return
        }

        await productVariantServiceTx.update(variantId, {
          inventory_quantity: variant.inventory_quantity + quantity,
        })
      })
    }

    await this.inventoryService_.deleteReservationItemsByLineItem(lineItemId)
  }

  /**
   * Adjusts inventory of a variant on a location
   * @param variantId variant id
   * @param locationId location id
   * @param quantity quantity to adjust
   */
  async adjustInventory(
    variantId: string,
    locationId: string,
    quantity: number
  ): Promise<void> {
    if (!this.inventoryService_) {
      return this.atomicPhase_(async (manager) => {
        const productVariantServiceTx =
          this.productVariantService_.withTransaction(manager)
        const variant = await productVariantServiceTx.retrieve(variantId, {
          select: ["id", "inventory_quantity", "manage_inventory"],
        })

        if (!variant.manage_inventory) {
          return
        }

        await productVariantServiceTx.update(variantId, {
          inventory_quantity: variant.inventory_quantity + quantity,
        })
      })
    } else {
      const variantInventory = await this.listByVariant(variantId)

      if (variantInventory.length === 0) {
        return
      }

      await Promise.all(
        variantInventory.map(async (inventoryPart) => {
          const itemQuantity = inventoryPart.quantity * quantity
          return await this.inventoryService_.adjustInventory(
            inventoryPart.inventory_item_id,
            locationId,
            itemQuantity
          )
        })
      )
    }
  }
}

export default ProductVariantInventoryService
