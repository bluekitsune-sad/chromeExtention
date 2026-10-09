// locations-data.js — curated location presets for the popup's autocomplete.
// Matching is substring-based, so "Karachi" matches a profile saying
// "Karachi, Pakistan". Free text still allowed — these exist to prevent typos.
// Loaded in popup.html before popup.js (not needed by content scripts).
(function () {
  "use strict";

  const PAKISTAN_CITIES = [
    "Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Multan",
    "Peshawar", "Quetta", "Hyderabad", "Gujranwala", "Sialkot", "Bahawalpur",
    "Sargodha", "Sukkur", "Larkana", " Abbottabad", "Mardan", "Mingora",
    "Dera Ghazi Khan", "Sahiwal", "Okara", "Wah Cantt", "Taxila", "Murree",
    "Gilgit", "Skardu", "Khuzdar", "Turbat", "Gwadar", "Mirpur", "Kotli",
    "Muzaffarabad", "Bhimber", "Jhelum", "Gujrat", "Sheikhupura", "Gujranwala",
    "Nawabshah", "Jacobabad", "Dera Ismail Khan", "Chitral", "Naran", "Hunza"
  ];

  const CITIES = [
    // Middle East / Gulf
    "Dubai", "Abu Dhabi", "Sharjah", "Riyadh", "Jeddah", "Mecca", "Medina",
    "Doha", "Kuwait City", "Manama", "Muscat", "Dammam", "Damascus", "Beirut",
    "Amman", "Jerusalem", "Tel Aviv", "Baghdad", "Erbil", "Sanaa", "Doha",
    // South Asia
    "Kabul", "Kandahar", "Tehran", "Mashhad", "Dhaka", "Chittagong", "Colombo",
    "Kandy", "Kathmandu", "Thimphu", "Male", "Mumbai", "Delhi", "New Delhi",
    "Bangalore", "Hyderabad India", "Chennai", "Kolkata", "Pune", "Ahmedabad",
    "Jaipur", "Lucknow", "Surat", "Nagpur", "Chandigarh", "Guwahati", "Kochi",
    // East / Southeast Asia
    "Tokyo", "Osaka", "Seoul", "Busan", "Hong Kong", "Taipei", "Shanghai",
    "Beijing", "Shenzhen", "Guangzhou", "Singapore", "Kuala Lumpur", "Jakarta",
    "Surabaya", "Bangkok", "Manila", "Cebu", "Hanoi", "Ho Chi Minh City",
    // Europe
    "London", "Manchester", "Birmingham", "Glasgow", "Edinburgh", "Dublin",
    "Paris", "Lyon", "Marseille", "Berlin", "Munich", "Hamburg", "Frankfurt",
    "Amsterdam", "Rotterdam", "Brussels", "Zurich", "Geneva", "Vienna",
    "Madrid", "Barcelona", "Lisbon", "Porto", "Rome", "Milan", "Athens",
    "Prague", "Warsaw", "Krakow", "Budapest", "Bucharest", "Sofia", "Belgrade",
    "Zagreb", "Stockholm", "Gothenburg", "Oslo", "Bergen", "Copenhagen",
    "Helsinki", "Reykjavik", "Kyiv", "Odesa", "Moscow", "St Petersburg",
    "Istanbul", "Ankara", "Baku", "Tbilisi", "Yerevan",
    // Africa
    "Cairo", "Alexandria", "Lagos", "Abuja", "Accra", "Nairobi", "Kampala",
    "Dar es Salaam", "Khartoum", "Casablanca", "Rabat", "Tunis", "Algiers",
    "Addis Ababa", "Dakar", "Johannesburg", "Cape Town", "Durban",
    "Port Harcourt", "Kano", "Kinshasa",
    // Americas
    "New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia",
    "San Antonio", "San Diego", "Dallas", "Austin", "San Jose", "Jacksonville",
    "San Francisco", "Seattle", "Boston", "Miami", "Atlanta", "Detroit",
    "Denver", "Las Vegas", "Portland", "Washington DC", "Baltimore",
    "Minneapolis", "Tampa", "Orlando", "Salt Lake City", "Charlotte",
    "Toronto", "Montreal", "Vancouver", "Calgary", "Edmonton", "Ottawa",
    "Mexico City", "Guadalajara", "Monterrey", "Havana", "Santo Domingo",
    "San Juan", "Bogota", "Medellin", "Lima", "Santiago", "Buenos Aires",
    "Montevideo", "Quito", "Caracas", "La Paz", "Asuncion",
    // Oceania
    "Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Auckland",
    "Wellington", "Christchurch", "Suva"
  ];

  const COUNTRIES = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Argentina",
    "Armenia", "Australia", "Austria", "Azerbaijan", "Bahamas", "Bahrain",
    "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin",
    "Bhutan", "Bolivia", "Bosnia", "Botswana", "Brazil", "Brunei", "Bulgaria",
    "Burkina Faso", "Burundi", "Cambodia", "Cameroon", "Canada", "Chad",
    "Chile", "China", "Colombia", "Costa Rica", "Croatia", "Cuba", "Cyprus",
    "Czech Republic", "Denmark", "Djibouti", "Dominican Republic", "Ecuador",
    "Egypt", "El Salvador", "Estonia", "Ethiopia", "Fiji", "Finland", "France",
    "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Guatemala",
    "Guinea", "Guyana", "Haiti", "Honduras", "Hungary", "Iceland", "India",
    "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast",
    "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait",
    "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Libya", "Lithuania",
    "Luxembourg", "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali",
    "Malta", "Mauritius", "Mexico", "Moldova", "Monaco", "Mongolia",
    "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nepal",
    "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea",
    "North Macedonia", "Norway", "Oman", "Pakistan", "Palestine", "Panama",
    "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal",
    "Qatar", "Romania", "Russia", "Rwanda", "Saudi Arabia", "Senegal",
    "Serbia", "Singapore", "Slovakia", "Slovenia", "Somalia", "South Africa",
    "South Korea", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname",
    "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania",
    "Thailand", "Togo", "Trinidad", "Tunisia", "Turkey", "Turkmenistan",
    "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
    "United States", "Uruguay", "Uzbekistan", "Venezuela", "Vietnam",
    "Yemen", "Zambia", "Zimbabwe"
  ];

  // de-dup + trim (a stray leading space would break exact matching)
  const all = [...new Set([...PAKISTAN_CITIES, ...CITIES, ...COUNTRIES].map((s) => s.trim()))];
  all.sort((a, b) => a.localeCompare(b));

  globalThis.XFF_LOCATION_PRESETS = all;
})();
