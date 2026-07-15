// controllers/banner.controller.js
const BannerService = require('../../services/banner.service');
const { ApiResponse, catchAsync } = require('../../utils/apiResponse');
const logger = require('../../config/logger');

// Import AI banner service
const { generateBannerImage, getBannerPrompt } = require('../../services/ai-banner.service');

class BannerController {
  /**
   * Public: get all live homepage banners grouped by type.
   * GET /api/v1/banners
   */
  getHomeBanners = catchAsync(async (req, res) => {
    const banners = await BannerService.getHomeBanners();
    return ApiResponse.success(res, 200, 'Banners retrieved successfully', { banners });
  });

  /**
   * Public: get live banners of a single type.
   * GET /api/v1/banners/:type?limit=
   */
  getBannersByType = catchAsync(async (req, res) => {
    const { type } = req.params;
    const { limit } = req.query;
    const banners = await BannerService.getActiveBanners({ type, limit });
    return ApiResponse.success(res, 200, 'Banners retrieved successfully', { banners });
  });

  /**
   * Public: track a click/impression (best-effort, always 200).
   * POST /api/v1/banners/:id/track
   */
  trackEvent = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { event } = req.body;
    await BannerService.trackEvent(id, event);
    return ApiResponse.success(res, 200, 'Event tracked');
  });

  /**
   * AI: Get the (editable) prompt for a banner type. The admin UI fetches this
   * when the type/title/description change, shows it, and may edit it.
   * GET /api/v1/banners/ai-prompt?type=&title=&description=&accent=
   */
  getBannerPromptPreview = catchAsync(async (req, res) => {
    const { type = 'hero', title = '', description = '', accent = '' } = req.query;
    const theme = accent ? { accent } : {};
    const prompt = getBannerPrompt(title, description, type, theme);
    return ApiResponse.success(res, 200, 'Prompt generated', { prompt });
  });

  /**
   * AI: Generate banner image using AI. Honors an admin-edited `prompt` when
   * supplied, otherwise builds one from the type template.
   * POST /api/v1/banners/ai-generate
   */
  generateAIBannerImagePreview = catchAsync(async (req, res) => {
    try {
      const { title, description, type, theme, prompt } = req.body;

      if (!title || !type) {
        return ApiResponse.error(res, 400, 'Title and type are required for AI image generation');
      }

      logger.info(`Generating AI banner image preview for ${title} (${type})`);
      const imageData = await generateBannerImage(title, description, type, theme, prompt);

      return ApiResponse.success(res, 200, 'AI image generated successfully', {
        ...imageData
      });
    } catch (error) {
      logger.error('AI image generation error:', error.message);
      return ApiResponse.error(res, 500, 'Failed to generate AI image', [error.message]);
    }
  });

  // ==================== ADMIN ====================

  getAllBanners = catchAsync(async (req, res) => {
    const result = await BannerService.getAllBanners(req.query);
    return ApiResponse.success(res, 200, 'Banners retrieved successfully', result);
  });

  getBanner = catchAsync(async (req, res) => {
    const banner = await BannerService.getBannerById(req.params.id);
    return ApiResponse.success(res, 200, 'Banner retrieved successfully', { banner });
  });

  createBanner = catchAsync(async (req, res) => {
    const adminId = req.admin?._id || req.user?._id;
    
    // Check if AI image generation is requested
    const useAI = req.body.useAIImage !== false;
    
    let banner = await BannerService.createBanner(req.body, adminId);
    
    if (useAI) {
      try {
        logger.info('Generating AI image during banner creation');
        const { enhanceBannerWithAIImage } = require('../../services/ai-banner.service');
        banner = await enhanceBannerWithAIImage(banner, req.body.aiPrompt);
      } catch (error) {
        logger.error('AI image generation failed:', error.message);
        banner.aiGenerated = false;
        banner.aiGenerationError = error.message;
        // Continue with the original banner without AI image
      }
    }
    
    return ApiResponse.created(res, 'Banner created successfully', { banner });
  });

  updateBanner = catchAsync(async (req, res) => {
    const adminId = req.admin?._id || req.user?._id;
    
    // Check if AI image regeneration is requested
    const regenerateAI = req.body.regenerateAIImage === true;
    
    let banner = await BannerService.updateBanner(req.params.id, req.body, adminId);
    
    if (regenerateAI) {
      try {
        logger.info('Regenerating AI image during banner update');
        const { enhanceBannerWithAIImage } = require('../../services/ai-banner.service');
        banner = await enhanceBannerWithAIImage(banner, req.body.aiPrompt);
      } catch (error) {
        logger.error('AI image regeneration failed:', error.message);
        banner.aiGenerated = false;
        banner.aiGenerationError = error.message;
        // Continue with the original banner without AI image
      }
    }
    
    return ApiResponse.success(res, 200, 'Banner updated successfully', { banner });
  });

  toggleStatus = catchAsync(async (req, res) => {
    const adminId = req.admin?._id || req.user?._id;
    const banner = await BannerService.toggleStatus(req.params.id, adminId);
    return ApiResponse.success(res, 200, 'Banner status updated', { banner });
  });

  deleteBanner = catchAsync(async (req, res) => {
    const result = await BannerService.deleteBanner(req.params.id);
    return ApiResponse.success(res, 200, result.message);
  });
}

module.exports = new BannerController();
