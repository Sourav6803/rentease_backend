// seed/categories.js
const categories = [
  {
    name: "Furniture",
    slug: "furniture",
    description: "Quality furniture for every room - living, bedroom, dining, and office",
    level: 0,
    parent: null,
    ancestors: [],
    isActive: true,
    isFeatured: true,
    displayOrder: 1,
    image: {
      url: "/images/categories/furniture.jpg",
      thumbnail: "/images/categories/thumb/furniture-thumb.jpg"
    },
    icon: "🛋️",
    meta: {
      title: "Rent Furniture Online - Sofa, Bed, Dining Table on Rent",
      description: "Rent premium furniture for home and office. Flexible rental plans starting at just ₹999/month. Choose from sofas, beds, dining tables, wardrobes and more.",
      keywords: ["furniture rental", "sofa on rent", "bed on rent", "dining table rental"]
    },
    attributes: [
      { name: "Material", type: "select", options: ["Wood", "Metal", "Fabric", "Leather", "Glass"], filterable: true },
      { name: "Color", type: "select", options: ["Brown", "Black", "White", "Grey", "Blue"], filterable: true },
      { name: "Dimensions", type: "text", filterable: false },
      { name: "Assembly Required", type: "boolean", filterable: true },
      { name: "Warranty", type: "text", filterable: false }
    ],
    metadata: {
      aiGenerated: false,
      suggestions: [
        "Sofas & Sectionals",
        "Beds & Mattresses",
        "Dining Tables & Chairs",
        "Wardrobes & Storage",
        "Office Furniture"
      ]
    }
  },
  {
    name: "Electronics",
    slug: "electronics",
    description: "Latest electronics and gadgets for home, office, and entertainment",
    level: 0,
    parent: null,
    ancestors: [],
    isActive: true,
    isFeatured: true,
    displayOrder: 2,
    image: {
      url: "/images/categories/electronics.jpg",
      thumbnail: "/images/categories/thumb/electronics-thumb.jpg"
    },
    icon: "💻",
    meta: {
      title: "Rent Electronics - Laptops, TVs, Gaming Consoles on Rent",
      description: "Rent the latest electronics at affordable monthly rentals. Laptops, desktops, smart TVs, gaming consoles, home theater systems available.",
      keywords: ["electronics rental", "laptop on rent", "TV on rent", "gaming console rental"]
    },
    attributes: [
      { name: "Brand", type: "select", options: ["Apple", "Samsung", "Sony", "Dell", "HP", "LG"], filterable: true },
      { name: "Condition", type: "select", options: ["New", "Like New", "Excellent", "Good"], filterable: true },
      { name: "Warranty Included", type: "boolean", filterable: true },
      { name: "Accessories Included", type: "text", filterable: false }
    ],
    metadata: {
      aiGenerated: false,
      suggestions: [
        "Laptops & Computers",
        "Smart TVs & Projectors",
        "Gaming Consoles",
        "Audio Systems",
        "Home Theater"
      ]
    }
  },
  {
    name: "Home Appliances",
    slug: "home-appliances",
    description: "Essential home appliances for kitchen, laundry, and daily living",
    level: 0,
    parent: null,
    ancestors: [],
    isActive: true,
    isFeatured: true,
    displayOrder: 3,
    image: {
      url: "/images/categories/home-appliances.jpg",
      thumbnail: "/images/categories/thumb/home-appliances-thumb.jpg"
    },
    icon: "🔧",
    meta: {
      title: "Rent Home Appliances - Refrigerator, Washing Machine, AC on Rent",
      description: "Rent home appliances with flexible monthly plans. Refrigerators, washing machines, air conditioners, microwaves available for rent.",
      keywords: ["home appliances rental", "refrigerator on rent", "washing machine rental", "AC on rent"]
    },
    attributes: [
      { name: "Brand", type: "select", options: ["Samsung", "LG", "Whirlpool", "Voltas", "Godrej"], filterable: true },
      { name: "Energy Rating", type: "select", options: ["5 Star", "4 Star", "3 Star", "2 Star"], filterable: true },
      { name: "Capacity", type: "text", filterable: true, unit: "L/kg" },
      { name: "Installation Included", type: "boolean", filterable: true }
    ],
    metadata: {
      aiGenerated: false,
      suggestions: [
        "Refrigerators",
        "Washing Machines",
        "Air Conditioners",
        "Microwaves & Ovens",
        "Water Purifiers"
      ]
    }
  },
  {
    name: "Kids & Baby",
    slug: "kids-baby",
    description: "Safe and quality products for your little ones",
    level: 0,
    parent: null,
    ancestors: [],
    isActive: true,
    isFeatured: false,
    displayOrder: 4,
    image: {
      url: "/images/categories/kids-baby.jpg",
      thumbnail: "/images/categories/thumb/kids-baby-thumb.jpg"
    },
    icon: "👶",
    meta: {
      title: "Rent Kids & Baby Products - Cribs, Car Seats, Toys on Rent",
      description: "Rent high-quality baby products at affordable prices. Cribs, car seats, strollers, toys, and more available for rent.",
      keywords: ["baby products rental", "crib on rent", "car seat rental", "baby toys rental"]
    },
    attributes: [
      { name: "Age Group", type: "select", options: ["0-6 months", "6-12 months", "1-2 years", "2-4 years", "4+ years"], filterable: true },
      { name: "Safety Certified", type: "boolean", filterable: true },
      { name: "Material", type: "select", options: ["Cotton", "Wood", "Plastic", "Metal"], filterable: true }
    ],
    metadata: {
      aiGenerated: false,
      suggestions: [
        "Cribs & Cradles",
        "Car Seats & Strollers",
        "Baby Toys",
        "High Chairs",
        "Baby Monitors"
      ]
    }
  },
  {
    name: "Sports & Fitness",
    slug: "sports-fitness",
    description: "Sports equipment and fitness gear for active lifestyle",
    level: 0,
    parent: null,
    ancestors: [],
    isActive: true,
    isFeatured: false,
    displayOrder: 5,
    image: {
      url: "/images/categories/sports-fitness.jpg",
      thumbnail: "/images/categories/thumb/sports-fitness-thumb.jpg"
    },
    icon: "⚽",
    meta: {
      title: "Rent Sports & Fitness Equipment - Treadmill, Gym Equipment on Rent",
      description: "Rent sports and fitness equipment for home or gym. Treadmills, exercise bikes, weights, and sports gear available.",
      keywords: ["fitness equipment rental", "treadmill on rent", "gym equipment rental", "sports gear rental"]
    },
    attributes: [
      { name: "Equipment Type", type: "select", options: ["Cardio", "Strength", "Sports", "Yoga"], filterable: true },
      { name: "Weight Capacity", type: "text", filterable: true, unit: "kg" },
      { name: "Brand", type: "select", options: ["Cosco", "Protoner", "Powermax", "Nivia"], filterable: true }
    ],
    metadata: {
      aiGenerated: false,
      suggestions: [
        "Treadmills",
        "Exercise Bikes",
        "Weight Training",
        "Yoga Mats",
        "Cricket & Badminton"
      ]
    }
  },
  {
    name: "Party & Events",
    slug: "party-events",
    description: "Everything you need for parties and special events",
    level: 0,
    parent: null,
    ancestors: [],
    isActive: true,
    isFeatured: false,
    displayOrder: 6,
    image: {
      url: "/images/categories/party-events.jpg",
      thumbnail: "/images/categories/thumb/party-events-thumb.jpg"
    },
    icon: "🎉",
    meta: {
      title: "Rent Party & Event Equipment - Decor, Sound, Furniture on Rent",
      description: "Rent party and event equipment for weddings, birthdays, corporate events. Decorations, sound system, furniture available.",
      keywords: ["party equipment rental", "event decoration rental", "sound system rental", "wedding decor"]
    },
    attributes: [
      { name: "Event Type", type: "select", options: ["Wedding", "Birthday", "Corporate", "Birthday"], filterable: true },
      { name: "Capacity", type: "text", filterable: true },
      { name: "Theme", type: "select", options: ["Modern", "Traditional", "Fairy Tale", "Minimalist"], filterable: true }
    ],
    metadata: {
      aiGenerated: false,
      suggestions: [
        "Party Decorations",
        "Sound Systems",
        "Lighting Equipment",
        "Party Furniture",
        "Photo Booths"
      ]
    }
  },
  {
    name: "Tools & Equipment",
    slug: "tools-equipment",
    description: "Professional tools and equipment for DIY and construction",
    level: 0,
    parent: null,
    ancestors: [],
    isActive: true,
    isFeatured: false,
    displayOrder: 7,
    image: {
      url: "/images/categories/tools-equipment.jpg",
      thumbnail: "/images/categories/thumb/tools-equipment-thumb.jpg"
    },
    icon: "🔨",
    meta: {
      title: "Rent Tools & Equipment - Power Tools, Construction Equipment on Rent",
      description: "Rent professional tools and equipment for your projects. Power tools, construction equipment, gardening tools available.",
      keywords: ["tools rental", "power tools on rent", "construction equipment rental", "DIY tools"]
    },
    attributes: [
      { name: "Tool Type", type: "select", options: ["Power Tools", "Hand Tools", "Gardening", "Construction"], filterable: true },
      { name: "Brand", type: "select", options: ["Bosch", "Makita", "Stanley", "Black+Decker"], filterable: true },
      { name: "Power Source", type: "select", options: ["Electric", "Battery", "Manual"], filterable: true }
    ],
    metadata: {
      aiGenerated: false,
      suggestions: [
        "Power Tools",
        "Hand Tools",
        "Gardening Tools",
        "Construction Equipment",
        "Safety Gear"
      ]
    }
  },
  {
    name: "Books & Media",
    slug: "books-media",
    description: "Books, movies, music, and more for entertainment and learning",
    level: 0,
    parent: null,
    ancestors: [],
    isActive: true,
    isFeatured: false,
    displayOrder: 8,
    image: {
      url: "/images/categories/books-media.jpg",
      thumbnail: "/images/categories/thumb/books-media-thumb.jpg"
    },
    icon: "📚",
    meta: {
      title: "Rent Books & Media - Novels, Movies, Music Albums on Rent",
      description: "Rent books, movies, and music albums. Fiction, non-fiction, educational books, Blu-rays, and more available.",
      keywords: ["book rental", "movie rental", "music rental", "library rental"]
    },
    attributes: [
      { name: "Genre", type: "select", options: ["Fiction", "Non-Fiction", "Educational", "Entertainment"], filterable: true },
      { name: "Language", type: "select", options: ["English", "Hindi", "Tamil", "Telugu", "Malayalam"], filterable: true },
      { name: "Format", type: "select", options: ["Paperback", "Hardcover", "eBook", "DVD", "Blu-ray"], filterable: true }
    ],
    metadata: {
      aiGenerated: false,
      suggestions: [
        "Fiction Books",
        "Educational Textbooks",
        "Movies & TV Series",
        "Music Albums",
        "Audio Books"
      ]
    }
  }
];

module.exports = categories;