"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        "collection_git_syncs",
        {
          id: {
            type: Sequelize.UUID,
            allowNull: false,
            primaryKey: true,
          },
          repositoryUrl: {
            type: Sequelize.STRING(2048),
            allowNull: false,
          },
          branch: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "main",
          },
          path: {
            type: Sequelize.STRING(1024),
            allowNull: false,
            defaultValue: "",
          },
          username: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          token: {
            type: Sequelize.BLOB,
            allowNull: true,
          },
          direction: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "bidirectional",
          },
          authorName: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          authorEmail: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          enabled: {
            type: Sequelize.BOOLEAN,
            allowNull: false,
            defaultValue: true,
          },
          webhookSecret: {
            type: Sequelize.STRING,
            allowNull: false,
          },
          status: {
            type: Sequelize.STRING,
            allowNull: false,
            defaultValue: "pending",
          },
          lastError: {
            type: Sequelize.TEXT,
            allowNull: true,
          },
          lastResult: {
            type: Sequelize.JSONB,
            allowNull: true,
          },
          lastCommitSha: {
            type: Sequelize.STRING,
            allowNull: true,
          },
          lastSyncedAt: {
            type: Sequelize.DATE,
            allowNull: true,
          },
          collectionId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "collections",
            },
            onDelete: "CASCADE",
          },
          createdById: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "users",
            },
            onDelete: "CASCADE",
          },
          teamId: {
            type: Sequelize.UUID,
            allowNull: false,
            references: {
              model: "teams",
            },
            onDelete: "CASCADE",
          },
          createdAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
          updatedAt: {
            type: Sequelize.DATE,
            allowNull: false,
          },
        },
        { transaction }
      );

      await queryInterface.addIndex("collection_git_syncs", ["collectionId"], {
        unique: true,
        transaction,
      });
      await queryInterface.addIndex("collection_git_syncs", ["teamId"], {
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("collection_git_syncs");
  },
};
