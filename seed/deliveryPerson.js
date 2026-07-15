const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// const User = require('../models/User.model');
// const DeliveryPerson = require('../models/DeliveryPerson.model');

const User = require('../src/models/User.model');
const DeliveryPerson = require('../src/models/DeliveryPerson.model');

require('dotenv').config();

const MONGO_URI = 'mongodb+srv://rick07539:iw5HHRv4JdunwlUR@cluster0.ffmnsa4.mongodb.net/rentEase?retryWrites=true&w=majority';

const firstNames = [
  'Rahul', 'Amit', 'Sourav', 'Rohit', 'Arjun',
  'Vikram', 'Ankit', 'Deepak', 'Karan', 'Manoj',
  'Sanjay', 'Ajay', 'Rakesh', 'Vivek', 'Nitin',
  'Abhishek', 'Pankaj', 'Raj', 'Sumit', 'Tarun'
];

const lastNames = [
  'Sharma', 'Kumar', 'Das', 'Singh', 'Roy',
  'Mondal', 'Gupta', 'Patel', 'Yadav', 'Jain'
];

const vehicleTypes = [
  'bike',
  'scooter',
  'car'
];

const zones = [
  'north',
  'south',
  'east',
  'west',
  'central'
];

const pincodes = [
  '713201',
  '713202',
  '713203',
  '713204',
  '713205'
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomCoordinate() {
  // Durgapur area coordinates
  return [
    87.2800 + Math.random() * 0.1, // lng
    23.5200 + Math.random() * 0.1  // lat
  ];
}

async function seedDeliveryPersons() {
  try {
    await mongoose.connect(MONGO_URI);

    console.log('MongoDB Connected');

    for (let i = 1; i <= 20; i++) {
      const firstName = randomItem(firstNames);
      const lastName = randomItem(lastNames);

      const email = `delivery${i}@example.com`;
      const phone = `987654${String(1000 + i)}`;

      const existingUser = await User.findOne({
        $or: [{ email }, { phone }]
      });

      if (existingUser) {
        console.log(`Skipping existing user ${email}`);
        continue;
      }

      const hashedPassword = await bcrypt.hash('Password@123', 10);

      // Create User
      const user = await User.create({
        email,
        phone,
        password: hashedPassword,
        role: 'delivery',
        isVerified: true,

        profile: {
          firstName,
          lastName,
          avatar: '',
          gender: 'male'
        }
      });

      // Create Delivery Person
      await DeliveryPerson.create({
        user: user._id,

        employeeId: `DLP${String(i).padStart(4, '0')}`,

        vehicle: {
          type: randomItem(vehicleTypes),
          number: `WB40${1000 + i}`,
          model: 'Hero Splendor',
          registrationNumber: `WB40AB${1000 + i}`,
          capacity: 25
        },

        zone: randomItem(zones),

        serviceablePincodes: [
          randomItem(pincodes),
          randomItem(pincodes)
        ],

        availability: {
          isAvailable: true,
          isOnDuty: Math.random() > 0.3,

          currentLocation: {
            type: 'Point',
            coordinates: randomCoordinate(),
            updatedAt: new Date()
          },

          shifts: {
            start: '09:00',
            end: '18:00',
            workingDays: [
              'monday',
              'tuesday',
              'wednesday',
              'thursday',
              'friday',
              'saturday'
            ]
          }
        },

        performance: {
          totalDeliveries: Math.floor(Math.random() * 500),
          completedDeliveries: Math.floor(Math.random() * 450),
          failedDeliveries: Math.floor(Math.random() * 20),
          cancelledDeliveries: Math.floor(Math.random() * 10),
          averageRating: (Math.random() * 2 + 3).toFixed(1),
          onTimeRate: Math.floor(Math.random() * 20 + 80),
          totalDistance: Math.floor(Math.random() * 5000),
          totalEarnings: Math.floor(Math.random() * 100000),
          lastDeliveryAt: new Date()
        },

        documents: [
          {
            type: 'license',
            number: `DL${100000 + i}`,
            url: `https://example.com/license-${i}.pdf`,
            verified: true,
            verifiedAt: new Date(),
            uploadedAt: new Date(),
            expiryDate: new Date('2030-12-31')
          },
          {
            type: 'aadhar',
            number: `1234123412${i}`,
            url: `https://example.com/aadhar-${i}.pdf`,
            verified: true,
            verifiedAt: new Date(),
            uploadedAt: new Date()
          }
        ],

        bankDetails: {
          accountHolderName: `${firstName} ${lastName}`,
          accountNumber: `1234567890${i}`,
          ifscCode: 'SBIN0001234',
          bankName: 'State Bank of India',
          upiId: `delivery${i}@upi`
        },

        currentAssignments: [],

        maxConcurrentDeliveries: 5,

        status: {
          isActive: true,
          isVerified: true,
          verificationStatus: 'verified'
        },

        metadata: {
          hiredAt: new Date(),
          notes: 'Seeded delivery person'
        }
      });

      console.log(`Created delivery person ${i}`);
    }

    console.log('20 Delivery Persons Seeded Successfully');

    process.exit(0);

  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

seedDeliveryPersons();