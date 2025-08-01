#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <Adafruit_Fingerprint.h>
#include <LiquidCrystal_I2C.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// LCD setup
LiquidCrystal_I2C lcd(0x27, 16, 2);

// WiFi credentials
#define WIFI_SSID "FE"
#define WIFI_PASSWORD "hellosuhasperi"

// Firebase credentials
#define API_KEY "AIzaSyDpf8wdB29v3r420hGKC4_dZrDI_SX29Mo"
#define DATABASE_URL "https://fingerprint-91d3d-default-rtdb.firebaseio.com"

// Serial and Fingerprint
HardwareSerial mySerial(1);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

// Firebase objects
FirebaseData sharedData, registerData, modeData;
FirebaseAuth auth;
FirebaseConfig config;

bool registrationMode = false;
uint8_t id = 0;
String registeredName = "";

void setup() {
  Serial.begin(115200);
  mySerial.begin(57600, SERIAL_8N1, 16, 17); // RX=16, TX=17

  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi connected");
  lcd.setCursor(0, 1);
  lcd.print("WiFi Connected");

  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  config.signer.tokens.legacy_token = "ey5lYMPxprI0f1SiagbN3V2ibf58SaoZ1NI5UOVm";
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  while (!Firebase.ready()) delay(100);
  Serial.println("✅ Firebase initialized");
  lcd.clear();
  lcd.print("Firebase Ready");

  if (!finger.verifyPassword()) {
    Serial.println("❌ Sensor not found!");
    lcd.clear();
    lcd.print("Sensor Error!");
    while (true) delay(1);
  }

  Serial.println("✅ Fingerprint sensor ready");
  lcd.setCursor(0, 1);
  lcd.print("Sensor Ready");

  finger.getTemplateCount();
  Serial.print("📊 Templates: ");
  Serial.println(finger.templateCount);
  delay(2000); 
  lcd.clear();
}

void loop() {
  if (Firebase.RTDB.getBool(&modeData, "/registerMode")) {
    registrationMode = modeData.boolData();
  }

  if (registrationMode) {
    lcd.clear();
    lcd.print("Registering...");
    if (Firebase.RTDB.getInt(&registerData, "/registerID")) {
      id = registerData.intData();

      if (id < 1 || id > 127) {
        Serial.println("❌ Invalid ID range");
        lcd.setCursor(0, 1);
        lcd.print("Invalid ID!");
        Firebase.RTDB.setString(&sharedData, "/errorMessage", "Invalid ID Range");
        Firebase.RTDB.setBool(&sharedData, "/errorBool", false);
        return;
      }

      // Fetch name
      String namePath = "/users/" + String(id) + "/name";
      if (Firebase.RTDB.getString(&sharedData, namePath)) {
        registeredName = sharedData.stringData();
        Serial.println("👤 Name: " + registeredName);
      } else {
        registeredName = "User";
        Serial.println("⚠ Name fetch failed");
      }

      // Clear registration state after fetching ID and name
      Firebase.RTDB.setBool(&sharedData, "/registerMode", false);
      Firebase.RTDB.setInt(&sharedData, "/registerID", 0);
      
      enrollFingerprint();
    } else {
      Serial.println("❌ registerID fetch failed");
      lcd.setCursor(0, 1);
      lcd.print("ID fetch fail");
      Firebase.RTDB.setBool(&sharedData, "/registerMode", false);
      Firebase.RTDB.setInt(&sharedData, "/registerID", 0);
    }
  } else {
    getFingerprintID();
  }

  delay(300);
}

// ---------------------- ENROLL ----------------------

void enrollFingerprint() {
  logEventToFirebase("Started enrollment for ID " + String(id));
  lcd.clear();
  lcd.print("Enroll:");
  lcd.setCursor(0, 1);
  lcd.print(registeredName);

  uint8_t result = getFingerprintEnroll();
  if (result == FINGERPRINT_OK) {
    Serial.println("✅ Enroll success");
    lcd.clear();
    lcd.print("Enrolled:");
    lcd.setCursor(0, 1);
    lcd.print(registeredName);
    Firebase.RTDB.setBool(&sharedData, "/success", true);
    Firebase.RTDB.setBool(&sharedData, "/registerMode", false);
  } else {
    Serial.print("❌ Enroll failed: ");
    Serial.println(result);
    lcd.clear();
    lcd.print("Enroll Failed:");
    lcd.setCursor(0, 1);
    lcd.print("Code: ");
    lcd.print(result);
    Firebase.RTDB.setBool(&sharedData, "/success", false);
    Firebase.RTDB.setString(&sharedData, "/errorMessage", "Enroll failed code: " + String(result));
    Firebase.RTDB.setBool(&sharedData, "/errorBool", false);
  }
}

uint8_t getFingerprintEnroll() {
  int p = -1;

  lcd.setCursor(0, 1);
  lcd.print("Place finger");

  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) {
      delay(100);
    } else if (p != FINGERPRINT_OK) {
      Serial.println("❌ getImage 1 failed");
      return p;
    }
  }

  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) return p;

  lcd.setCursor(0, 1);
  lcd.print("Remove finger ");
  delay(2000);
  while (finger.getImage() != FINGERPRINT_NOFINGER);

  lcd.setCursor(0, 1);
  lcd.print("Place again...");

  while ((p = finger.getImage()) != FINGERPRINT_OK) {
    if (p != FINGERPRINT_NOFINGER) return p;
    delay(100);
  }

  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) return p;

  p = finger.createModel();
  if (p != FINGERPRINT_OK) return p;

  p = finger.storeModel(id);
  if (p != FINGERPRINT_OK) return p;

  return FINGERPRINT_OK;
}

// ---------------------- VERIFY ----------------------

uint8_t getFingerprintID() {
  finger.getTemplateCount();

  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK) return p;

  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) return p;

  p = finger.fingerSearch();
  if (p == FINGERPRINT_OK) {
    Serial.print("✅ Match found! ID: ");
    Serial.println(finger.fingerID);

    // Fetch name
    String namePath = "/users/" + String(finger.fingerID) + "/name";
    String name = "";
    if (Firebase.RTDB.getString(&sharedData, namePath)) {
      name = sharedData.stringData();
    } else {
      name = "Unknown";
    }

    lcd.clear();
    lcd.print(name);
    lcd.setCursor(0, 1);
    lcd.print("Marked Present");

    sendToFirebase(finger.fingerID);
    logEventToFirebase("✅ Verified ID " + String(finger.fingerID) + " (" + name + ")");
  } else {
    Serial.println("❌ No match");
    lcd.clear();
    lcd.print("No Match Found");
    Firebase.RTDB.setString(&sharedData, "/errorMessage", "No Match Found");
    Firebase.RTDB.setBool(&sharedData, "/errorBool", false);
  }

  return p;
}

void sendToFirebase(uint8_t id) {
  Firebase.RTDB.setInt(&sharedData, "/id", id);
  Firebase.RTDB.setBool(&sharedData, "/value", true);
  Firebase.RTDB.setString(&sharedData, "/errorMessage", "Marked Present");
  Firebase.RTDB.setBool(&sharedData, "/errorBool", true);
}

void logEventToFirebase(String message) {
  String path = "/logs/" + String(millis());
  Firebase.RTDB.setString(&sharedData, path, message);
  Serial.println("📝 Log: " + message);
}