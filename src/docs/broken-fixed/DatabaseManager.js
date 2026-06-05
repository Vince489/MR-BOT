import mongoose from "mongoose";
import Message from "./models/Message.js";
import { EventEmitter } from "events";

/**
 * DatabaseManager class handles all MongoDB operations
 */
export class DatabaseManager extends EventEmitter {
    /**
     * Creates a new DatabaseManager instance
     */
    constructor() {
        super();
        this.dbConnection = null;
        this.mongoUri = null;
        this.connectionPromise = null;
    }

    /**
     * Ensure database connection is established
     * @returns {Promise} - Promise that resolves when connected
     * @private
     */
    async _ensureConnected() {
        if (this.dbConnection) {
            // Already connected
            return;
        }

        if (!this.mongoUri) {
            throw new Error("MongoDB URI not set. Call setMongoUri() first.");
        }

        // If connection is already in progress, wait for it
        if (this.connectionPromise) {
            return this.connectionPromise;
        }

        // Create and store connection promise
        this.connectionPromise = mongoose.connect(this.mongoUri)
            .then(connection => {
                this.dbConnection = connection;
                this.emit("database_connected", this.dbConnection);
                return connection;
            })
            .catch(error => {
                this.emit("database_error", error);
                throw error;
            })
            .finally(() => {
                this.connectionPromise = null;
            });

        return this.connectionPromise;
    }

    /**
     * Set MongoDB connection URI
     * @param {string} mongoUri - MongoDB connection URI
     */
    setMongoUri(mongoUri) {
        this.mongoUri = mongoUri;
    }

    /**
     * Disconnect from MongoDB
     */
    async disconnectFromDatabase() {
        if (this.dbConnection) {
            await mongoose.disconnect();
            this.emit("database_disconnected");
        }
    }

    /**
     * Save a message to MongoDB
     * @param {Object} messageData - Message data to save
     * @returns {Promise<Object>} - Saved message document
     */
    async saveMessage(messageData) {
        await this._ensureConnected();
        const message = new Message(messageData);
        return await message.save();
    }

    /**
     * Find messages in MongoDB
     * @param {Object} query - Query to find messages
     * @returns {Promise<Array>} - Array of found message documents
     */
    async findMessages(query = {}) {
        await this._ensureConnected();
        return await Message.find(query);
    }

}