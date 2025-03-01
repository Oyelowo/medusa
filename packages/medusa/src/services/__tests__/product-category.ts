import { IdMap, MockRepository, MockManager } from "medusa-test-utils"
import ProductCategoryService from "../product-category"

describe("ProductCategoryService", () => {
  const validProdCategoryId = "skinny-jeans"
  const invalidProdCategoryId = "not-found"

  describe("retrieve", () => {
    const productCategoryRepository = MockRepository({
      findOne: query => {
        if (query.where.id === invalidProdCategoryId) {
          return Promise.resolve(undefined)
        }

        return Promise.resolve({ id: IdMap.getId(validProdCategoryId) })
      },
      findDescendantsTree: productCategory => {
        return Promise.resolve(productCategory)
      }
    })

    const productCategoryService = new ProductCategoryService({
      manager: MockManager,
      productCategoryRepository,
    })

    beforeEach(async () => { jest.clearAllMocks() })

    it("successfully retrieves a product category", async () => {
      const result = await productCategoryService.retrieve(
        IdMap.getId(validProdCategoryId)
      )

      expect(result.id).toEqual(IdMap.getId(validProdCategoryId))
      expect(productCategoryRepository.findOne).toHaveBeenCalledTimes(1)
      expect(productCategoryRepository.findDescendantsTree).toHaveBeenCalledTimes(1)
      expect(productCategoryRepository.findOne).toHaveBeenCalledWith({
        where: { id: IdMap.getId(validProdCategoryId) },
      })
    })

    it("fails on not-found product category id", async () => {
      const categoryResponse = await productCategoryService
        .retrieve(invalidProdCategoryId)
        .catch((e) => e)

      expect(categoryResponse.message).toBe(
        `ProductCategory with id: not-found was not found`
      )
    })
  })

  describe("listAndCount", () => {
    const productCategoryRepository = {
      ...MockRepository({}),
      getFreeTextSearchResultsAndCount: jest.fn().mockImplementation((query, q) => {
        if (q == "not-found") {
          return Promise.resolve([[], 0])
        }

        return Promise.resolve([[{ id: IdMap.getId(validProdCategoryId) }], 1])
      })
    }

    const productCategoryService = new ProductCategoryService({
      manager: MockManager,
      productCategoryRepository,
    })

    beforeEach(async () => { jest.clearAllMocks() })

    it("successfully retrieves an array of product category", async () => {
      const [result, count] = await productCategoryService
        .listAndCount({ q: validProdCategoryId })

      expect(count).toEqual(1)
      expect(result.length).toEqual(1)
      expect(result[0].id).toEqual(IdMap.getId(validProdCategoryId))
      expect(productCategoryRepository.getFreeTextSearchResultsAndCount).toHaveBeenCalledTimes(1)
      expect(productCategoryRepository.getFreeTextSearchResultsAndCount).toHaveBeenCalledWith({
        order: {
          created_at: "DESC",
        },
        skip: 0,
        take: 100,
        where: {},
      }, validProdCategoryId)
    })

    it("returns empty array if query doesn't match database results", async () => {
      const [result, count] = await productCategoryService
        .listAndCount({ q: "not-found" })

      expect(productCategoryRepository.getFreeTextSearchResultsAndCount).toHaveBeenCalledTimes(1)
      expect(result).toEqual([])
      expect(count).toEqual(0)
    })
  })

  describe("create", () => {
    const productCategoryRepository = MockRepository({
      findOne: query => Promise.resolve({ id: IdMap.getId("jeans") }),
    })

    const productCategoryService = new ProductCategoryService({
      manager: MockManager,
      productCategoryRepository,
    })

    beforeEach(async () => {
      jest.clearAllMocks()
    })

    it("successfully creates a product category", async () => {
      await productCategoryService.create({ name: "jeans" })

      expect(productCategoryRepository.create).toHaveBeenCalledTimes(1)
      expect(productCategoryRepository.create).toHaveBeenCalledWith({
        name: "jeans",
      })
    })
  })

  describe("delete", () => {
    const productCategoryRepository = MockRepository({
      findOne: query => {
        if (query.where.id === "not-found") {
          return Promise.resolve(undefined)
        }

        if (query.where.id === "with-children") {
          return Promise.resolve({
            id: IdMap.getId("with-children"),
            category_children: [{
              id: IdMap.getId("skinny-jeans"),
            }]
          })
        }

        return Promise.resolve({
          id: IdMap.getId("jeans"),
          category_children: []
        })
      },
      findDescendantsTree: (productCategory) => {
        return Promise.resolve(productCategory)
      },
    })

    const productCategoryService = new ProductCategoryService({
      manager: MockManager,
      productCategoryRepository,
    })

    beforeEach(async () => { jest.clearAllMocks() })

    it("successfully deletes a product category", async () => {
      const result = await productCategoryService.delete(
        IdMap.getId("jeans")
      )

      expect(productCategoryRepository.delete).toBeCalledTimes(1)
      expect(productCategoryRepository.delete).toBeCalledWith(IdMap.getId("jeans"))
    })

    it("returns without failure on not-found product category id", async () => {
      const categoryResponse = await productCategoryService
        .delete("not-found")

      expect(categoryResponse).toBe(undefined)
    })

    it("fails on product category with children", async () => {
      const categoryResponse = await productCategoryService
        .delete("with-children")
        .catch((e) => e)

      expect(categoryResponse.message).toBe(
        `Deleting ProductCategory (with-children) with category children is not allowed`
      )
    })
  })
})
